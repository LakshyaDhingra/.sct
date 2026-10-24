import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Identity } from 'spacetimedb'
import { DbConnection } from './relay'
import { decodeFile, encodeFile, open, seal } from './seal'
import type { DeviceCard } from './transfer'
import type { RelayConnection, RelayInboxItem, RelayPeer, RelaySentItem, RelayState } from '../shared/relay'

export interface RelayServer {
  uri: string
  database: string
}

// The cache keeps the relay rows of the last connection. Inbox payloads and wrapped keys stay ciphertext.
interface Cache {
  identity: string | null
  updatedAt: string | null
  peers: (RelayPeer & { encryptionPublicKey: string; signingPublicKey: string })[]
  inbox: (RelayInboxItem & { payload: string; wrappedKey: string })[]
  sent: RelaySentItem[]
}

const liveServer: RelayServer = { uri: 'https://maincloud.spacetimedb.com', database: 'sct-relay' }
const magic = Buffer.from('SCR1')
const emptyCache: Cache = { identity: null, updatedAt: null, peers: [], inbox: [], sent: [] }

// SCT_RELAY=off turns the relay off. SCT_RELAY=<server URL>/<database> selects another relay, such as a local test server.
export function relayServer(setting = process.env.SCT_RELAY): RelayServer | undefined {
  if (setting === 'off') return undefined
  if (!setting) return liveServer
  const url = new URL(setting)
  const database = url.pathname.slice(1)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(database)) throw new Error('Set SCT_RELAY to off, or to a server URL followed by a database name.')
  return { uri: url.origin, database }
}

export class Relay {
  private connection: DbConnection | undefined
  private cache: Cache = emptyCache
  private status: RelayConnection
  private registered = false
  private error: string | null = null
  private attempt = 0
  private retry: NodeJS.Timeout | undefined
  private stopped = false
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly server: RelayServer | undefined, private readonly cacheFile: string,
    private readonly deviceCard: () => Promise<DeviceCard>, private readonly changed: () => void,
    private readonly service = '.sct-relay') {
    this.status = server ? 'connecting' : 'off'
  }

  async start(): Promise<void> {
    if (!this.server) return
    this.cache = await this.readCache()
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.connection?.disconnect()
  }

  state(): RelayState {
    return {
      connection: this.status,
      identity: this.cache.identity,
      registered: this.registered,
      error: this.error,
      updatedAt: this.cache.updatedAt,
      peers: this.cache.peers.map(({ pairId, identity, name, status }) => ({ pairId, identity, name, status })),
      inbox: this.cache.inbox.map(({ messageId, sender, createdAt }) => ({ messageId, sender, createdAt })),
      sent: this.cache.sent
    }
  }

  private async connect(): Promise<void> {
    const server = requireServer(this.server)
    this.update('connecting')
    let token: string | undefined
    try {
      token = await this.readToken()
    } catch (error) {
      return this.lost(error, undefined)
    }
    // Automatic reconnects replay the subscription. A new connection starts after the library stops retrying.
    this.connection = DbConnection.builder()
      .withUri(server.uri)
      .withDatabaseName(server.database)
      .withToken(token)
      .withAutomaticReconnect()
      .onConnect((connection, identity, newToken) => {
        this.watch(connection)
        void this.connected(connection, identity, newToken, token)
      })
      .onAutomaticReconnect(() => {
        this.attempt = 0
        this.error = null
        this.update('connected')
      })
      .onConnectError((_context, error, nextAttempt) => this.lost(error, nextAttempt))
      .onDisconnect((_context, error, nextAttempt) => this.lost(error, nextAttempt))
      .build()
  }

  private async connected(connection: DbConnection, identity: Identity, token: string, savedToken: string | undefined): Promise<void> {
    this.attempt = 0
    this.error = null
    this.cache = { ...this.cache, identity: identity.toHexString() }
    this.update('connected')
    if (token !== savedToken) {
      try {
        await this.entry(`token/${this.serverName()}`).setPassword(token)
      } catch (error) {
        this.error = `Cannot save the relay token. This device gets a new relay identity at the next start. ${message(error)}`
        this.changed()
      }
    }
    try {
      const card = await this.deviceCard()
      await connection.reducers.registerDevice({
        name: card.name,
        encryptionPublicKey: Buffer.from(card.encryptionKey, 'base64'),
        signingPublicKey: Buffer.from(card.signingKey, 'base64')
      })
      this.registered = true
    } catch (error) {
      this.registered = false
      this.error = `Cannot register this device on the relay. ${message(error)}`
    }
    this.changed()
  }

  private watch(connection: DbConnection): void {
    const refresh = () => this.refresh(connection)
    for (const view of [connection.db.myInbox, connection.db.mySent, connection.db.myPeers]) {
      view.onInsert(refresh)
      view.onDelete(refresh)
    }
    connection.subscriptionBuilder()
      .onApplied(refresh)
      .onError((context) => {
        this.error = `Cannot read the relay. ${message(context.event)}`
        this.changed()
      })
      .subscribe(['SELECT * FROM my_inbox', 'SELECT * FROM my_sent', 'SELECT * FROM my_peers'])
  }

  private refresh(connection: DbConnection): void {
    this.cache = {
      identity: this.cache.identity,
      updatedAt: new Date().toISOString(),
      peers: [...connection.db.myPeers.iter()].map((row) => ({
        pairId: row.pairId.toString(),
        identity: row.identity.toHexString(),
        name: row.name,
        status: row.status.tag,
        encryptionPublicKey: Buffer.from(row.encryptionPublicKey).toString('base64'),
        signingPublicKey: Buffer.from(row.signingPublicKey).toString('base64')
      })),
      inbox: [...connection.db.myInbox.iter()].map((row) => ({
        messageId: row.messageId,
        sender: row.sender.toHexString(),
        createdAt: row.createdAt.toISOString(),
        payload: Buffer.from(row.payload).toString('base64'),
        wrappedKey: Buffer.from(row.wrappedKey).toString('base64')
      })),
      sent: [...connection.db.mySent.iter()].map((row) => ({
        messageId: row.messageId,
        recipient: row.recipient.toHexString(),
        status: row.status.tag,
        receivedAt: row.receivedAt?.toISOString() ?? null
      }))
    }
    this.saving = this.saving.then(() => this.writeCache(this.cache)).catch((error: unknown) => {
      this.error = `Cannot save the relay cache. ${message(error)}`
    })
    this.changed()
  }

  private lost(error: unknown, nextAttempt: number | undefined): void {
    this.error = `The relay is unavailable. ${message(error)}`
    this.update('offline')
    if (nextAttempt !== undefined || this.stopped) return
    this.connection = undefined
    this.attempt += 1
    this.retry = setTimeout(() => void this.connect(), Math.min(1000 * 2 ** (this.attempt - 1), 30_000))
  }

  private update(connection: RelayConnection): void {
    this.status = connection
    this.changed()
  }

  private async readToken(): Promise<string | undefined> {
    return (await this.entry(`token/${this.serverName()}`).getPassword()) ?? undefined
  }

  // The cache only copies relay rows. An unreadable cache starts empty, and the next subscription fills it again.
  private async readCache(): Promise<Cache> {
    try {
      const sealed = decodeFile(magic, await readFile(this.cacheFile))
      const key = await this.entry(`cache/${this.serverName()}`).getSecret()
      if (!sealed || !key) return emptyCache
      return JSON.parse(open(Buffer.from(key), sealed, this.cacheData()).toString('utf8')) as Cache
    } catch {
      return emptyCache
    }
  }

  private async writeCache(cache: Cache): Promise<void> {
    const saved = await this.entry(`cache/${this.serverName()}`).getSecret()
    const key = saved ? Buffer.from(saved) : randomBytes(32)
    if (!saved) await this.entry(`cache/${this.serverName()}`).setSecret(key)
    await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 })
    await writeFile(`${this.cacheFile}.tmp`, encodeFile(magic, seal(key, Buffer.from(JSON.stringify(cache)), this.cacheData())), { mode: 0o600 })
    await rename(`${this.cacheFile}.tmp`, this.cacheFile)
  }

  // Each relay server has its own identity. The cache of one server does not open for another server.
  private cacheData(): Buffer {
    return Buffer.from(`relay-cache/${this.serverName()}`)
  }

  private serverName(): string {
    const server = requireServer(this.server)
    return `${server.uri}/${server.database}`
  }

  private entry(account: string): AsyncEntry {
    return new AsyncEntry(this.service, account)
  }
}

function requireServer(server: RelayServer | undefined): RelayServer {
  if (!server) throw new Error('The relay is turned off.')
  return server
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}
