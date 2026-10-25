import { AsyncEntry } from '@napi-rs/keyring'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Identity } from 'spacetimedb'
import { DbConnection } from './relay'
import { decodeFile, encodeFile, open, seal } from './seal'
import { readTransfer } from './envelope'
import type { RelayPeerKeys, SealedTransfer } from './envelope'
import { readDeviceCard, relayPairingCode } from './transfer'
import type { DeviceCard } from './transfer'
import type { RelayConnection, RelayInboxItem, RelayPeer, RelaySentItem, RelayState, RelayTransferInput } from '../shared/relay'

export interface RelayServer {
  uri: string
  database: string
}

interface CachedPeer {
  pairId: string
  identity: string
  initiator: string
  name: string
  status: RelayPeer['status']
  encryptionPublicKey: string
  signingPublicKey: string
}

interface CachedSentItem {
  messageId: string
  recipient: string
  status: 'Pending' | 'Received'
  receivedAt: string | null
}

// The cache keeps the relay rows of the last connection. Inbox payloads and wrapped keys stay ciphertext.
interface Cache {
  identity: string | null
  updatedAt: string | null
  peers: CachedPeer[]
  inbox: (RelayInboxItem & { payload: string; wrappedKey: string })[]
  sent: CachedSentItem[]
}

interface OutboundTransfer {
  messageId: string
  recipient: string
  createdAt: number
  deliverBy: number
  payload: string
  wrappedKey: string
}

// The keys of a peer at the time both users compared the pairing code.
interface Pin {
  identity: string
  encryptionKey: string
  signingKey: string
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
  private outbox: OutboundTransfer[] = []
  private pins: Pin[] = []
  private status: RelayConnection
  private registered = false
  private error: string | null = null
  private attempt = 0
  private retry: NodeJS.Timeout | undefined
  private stopped = false
  private saving: Promise<void> = Promise.resolve()
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly server: RelayServer | undefined, private readonly directory: string,
    private readonly deviceCard: () => Promise<DeviceCard>,
    private readonly prepareTransfer: (identity: string, recipient: RelayPeerKeys, input: RelayTransferInput) => Promise<SealedTransfer>,
    private readonly changed: () => void,
    private readonly service = '.sct-relay') {
    this.status = server ? 'connecting' : 'off'
  }

  async start(): Promise<void> {
    if (!this.server) return
    const [cache, outbox] = await Promise.all([
      this.readSealed('cache', emptyCache),
      this.readSealed<{ transfers: OutboundTransfer[] }>('outbox', { transfers: [] })
    ])
    this.cache = cache
    this.outbox = outbox.transfers
    // An unreadable list fails closed: every peer needs a new code comparison.
    this.pins = (await this.readSealed<{ pins: Pin[] }>('peers', { pins: [] })).pins
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.connection?.disconnect()
  }

  async state(): Promise<RelayState> {
    const local = await this.deviceCard().catch(() => undefined)
    return {
      connection: this.status,
      identity: this.cache.identity,
      registered: this.registered,
      error: this.error,
      updatedAt: this.cache.updatedAt,
      peers: this.cache.peers.map((peer) => describePeer(peer, local, this.cache.identity, this.pins)),
      inbox: this.cache.inbox.map(({ messageId, sender, createdAt }) => ({ messageId, sender, createdAt })),
      sent: this.sentItems()
    }
  }

  queueTransfer(value: unknown): Promise<void> {
    return this.serialize(async () => {
      const input = requireTransferInput(value)
      const identity = this.cache.identity
      if (!identity) throw new Error('Connect this device to the relay before you queue a transfer.')
      const peer = this.cache.peers.find((saved) => saved.identity === input.recipient)
      if (!peer || peer.status !== 'Verified' || describePeer(peer, await this.deviceCard(), identity, this.pins).trust !== 'verified') {
        throw new Error('Select a verified relay recipient.')
      }
      const card = peerCard(peer)
      if (!card) throw new Error('The recipient keys are invalid. Remove this pair and pair the devices again.')
      const sealed = await this.prepareTransfer(identity, { identity: peer.identity, card }, input)
      const transfer = readTransfer(sealed.payload)
      const wrappedKey = sealed.wrappedKeys.find((entry) => entry.recipient === peer.identity)
      if (!wrappedKey) throw new Error('Cannot find the encrypted key for this recipient.')
      const transfers = [...this.outbox, {
        messageId: transfer.id,
        recipient: peer.identity,
        createdAt: transfer.createdAt,
        deliverBy: transfer.deliverBy,
        payload: sealed.payload.toString('base64'),
        wrappedKey: wrappedKey.wrappedKey.toString('base64')
      }]
      await this.writeSealed('outbox', { transfers })
      this.outbox = transfers
      this.changed()
    })
  }

  requestPair(identity: unknown): Promise<void> {
    if (typeof identity !== 'string' || !/^[0-9a-f]{64}$/.test(identity)) {
      throw new Error('Enter the relay ID of the other device: 64 characters from 0 to 9 and a to f.')
    }
    return this.requireConnection().reducers.requestPair({ peer: Identity.fromString(identity) })
  }

  // The user confirms the code on the screen. A different current code means that the keys changed after display.
  confirmPair(input: unknown): Promise<void> {
    return this.serialize(async () => {
      const { pairId, code } = requireConfirmation(input)
      const peer = this.requirePeer(pairId)
      const current = describePeer(peer, await this.deviceCard(), this.cache.identity, this.pins)
      if (!current.code || current.code !== code) throw new Error('The pairing code changed. Compare the new code on both devices.')
      if (!current.requestedByMe && peer.status === 'Pending') {
        await this.requireConnection().reducers.confirmPair({ pairId: BigInt(pairId) })
      }
      await this.savePins([...this.pins.filter((pin) => pin.identity !== peer.identity),
        { identity: peer.identity, encryptionKey: peer.encryptionPublicKey, signingKey: peer.signingPublicKey }])
    })
  }

  removePair(pairId: unknown): Promise<void> {
    return this.serialize(async () => {
      const peer = this.requirePeer(requirePairId(pairId))
      await this.requireConnection().reducers.removePair({ pairId: BigInt(peer.pairId) })
      await this.savePins(this.pins.filter((pin) => pin.identity !== peer.identity))
    })
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
        initiator: row.initiator.toHexString(),
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
    this.saving = this.saving.then(() => this.writeSealed('cache', this.cache)).catch((error: unknown) => {
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

  private requireConnection(): DbConnection {
    if (this.status !== 'connected' || !this.connection) throw new Error('Connect to the relay first. Check your network connection and try again.')
    return this.connection
  }

  private requirePeer(pairId: string): CachedPeer {
    const peer = this.cache.peers.find((saved) => saved.pairId === pairId)
    if (!peer) throw new Error('This pair does not exist. Refresh the list and try again.')
    return peer
  }

  private async savePins(pins: Pin[]): Promise<void> {
    await this.writeSealed('peers', { pins })
    this.pins = pins
    this.changed()
  }

  private sentItems(now = Date.now()): RelaySentItem[] {
    const remote = new Map(this.cache.sent.map((item) => [`${item.messageId}/${item.recipient}`, item]))
    const items = this.outbox.map((item): RelaySentItem => {
      const sent = remote.get(`${item.messageId}/${item.recipient}`)
      remote.delete(`${item.messageId}/${item.recipient}`)
      return {
        messageId: item.messageId,
        recipient: item.recipient,
        state: sent?.status === 'Received' ? 'received' : sent ? 'sent' : item.deliverBy <= now ? 'expired' : 'queued',
        createdAt: new Date(item.createdAt).toISOString(),
        deliverBy: new Date(item.deliverBy).toISOString(),
        receivedAt: sent?.receivedAt ?? null,
        error: null
      }
    })
    for (const sent of remote.values()) items.push({
      messageId: sent.messageId,
      recipient: sent.recipient,
      state: sent.status === 'Received' ? 'received' : 'sent',
      createdAt: null,
      deliverBy: null,
      receivedAt: sent.receivedAt,
      error: null
    })
    return items.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
  }

  private async readToken(): Promise<string | undefined> {
    return (await this.entry(`token/${this.serverName()}`).getPassword()) ?? undefined
  }

  // An unreadable file returns the empty value. The cache refills from the next subscription.
  private async readSealed<T>(name: 'cache' | 'peers' | 'outbox', empty: T): Promise<T> {
    try {
      const sealed = decodeFile(magic, await readFile(this.sealedFile(name)))
      const key = await this.entry(`${name}/${this.serverName()}`).getSecret()
      if (!sealed || !key) return empty
      // GCM authenticates the contents, so only this app can produce them.
      return JSON.parse(open(Buffer.from(key), sealed, this.sealedData(name)).toString('utf8')) as T
    } catch {
      return empty
    }
  }

  private async writeSealed(name: 'cache' | 'peers' | 'outbox', value: unknown): Promise<void> {
    const saved = await this.entry(`${name}/${this.serverName()}`).getSecret()
    const key = saved ? Buffer.from(saved) : randomBytes(32)
    if (!saved) await this.entry(`${name}/${this.serverName()}`).setSecret(key)
    const file = this.sealedFile(name)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await writeFile(`${file}.tmp`, encodeFile(magic, seal(key, Buffer.from(JSON.stringify(value)), this.sealedData(name))), { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }

  // Each relay server has its own identity, so each server has its own files. A test server cannot replace the files of the live relay.
  private sealedFile(name: 'cache' | 'peers' | 'outbox'): string {
    return join(this.directory, `${name}-${createHash('sha256').update(this.serverName()).digest('hex').slice(0, 16)}.sct`)
  }

  private sealedData(name: 'cache' | 'peers' | 'outbox'): Buffer {
    return Buffer.from(`relay-${name}/${this.serverName()}`)
  }

  private serverName(): string {
    const server = requireServer(this.server)
    return `${server.uri}/${server.database}`
  }

  private entry(account: string): AsyncEntry {
    return new AsyncEntry(this.service, account)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}

function describePeer(peer: CachedPeer, local: DeviceCard | undefined, localIdentity: string | null, pins: Pin[]): RelayPeer {
  const card = peerCard(peer)
  const pin = pins.find((saved) => saved.identity === peer.identity)
  return {
    pairId: peer.pairId,
    identity: peer.identity,
    name: peer.name,
    status: peer.status,
    requestedByMe: peer.initiator === localIdentity,
    code: card && local && localIdentity ? relayPairingCode(local, localIdentity, card, peer.identity) : null,
    trust: !card ? 'invalid' : !pin ? 'unverified'
      : pin.encryptionKey === card.encryptionKey && pin.signingKey === card.signingKey ? 'verified' : 'changed'
  }
}

// The relay accepts any key bytes. The device card rules accept only X25519 and Ed25519 public keys.
function peerCard(peer: CachedPeer): DeviceCard | undefined {
  try {
    return readDeviceCard(Buffer.from(JSON.stringify({ format: 'sct-device', version: 1, name: peer.name,
      encryptionKey: peer.encryptionPublicKey, signingKey: peer.signingPublicKey })))
  } catch {
    return undefined
  }
}

function requireConfirmation(input: unknown): { pairId: string; code: string } {
  if (typeof input !== 'object' || input === null || !('code' in input) || typeof input.code !== 'string' || !('pairId' in input)) {
    throw new Error('Select a pair and its pairing code.')
  }
  return { pairId: requirePairId(input.pairId), code: input.code }
}

function requirePairId(pairId: unknown): string {
  if (typeof pairId !== 'string' || !/^[0-9]{1,20}$/.test(pairId)) throw new Error('The pair ID is invalid.')
  return pairId
}

function requireTransferInput(value: unknown): RelayTransferInput {
  if (typeof value !== 'object' || value === null || !('projectId' in value) || typeof value.projectId !== 'string' ||
    !('secretIds' in value) || !Array.isArray(value.secretIds) || !value.secretIds.every((id) => typeof id === 'string') ||
    !('recipient' in value) || typeof value.recipient !== 'string' || !/^[0-9a-f]{64}$/.test(value.recipient) ||
    !('deliverBy' in value) || !Number.isSafeInteger(value.deliverBy) ||
    !('accessExpiresAt' in value) || (value.accessExpiresAt !== null && !Number.isSafeInteger(value.accessExpiresAt)) ||
    !('injectionOnly' in value) || typeof value.injectionOnly !== 'boolean') {
    throw new Error('Select a project, secrets, verified recipient, and valid deadlines.')
  }
  return {
    projectId: value.projectId,
    secretIds: value.secretIds,
    recipient: value.recipient,
    deliverBy: value.deliverBy as number,
    accessExpiresAt: value.accessExpiresAt as number | null,
    injectionOnly: value.injectionOnly
  }
}

function requireServer(server: RelayServer | undefined): RelayServer {
  if (!server) throw new Error('The relay is turned off.')
  return server
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}
