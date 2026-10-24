import { AsyncEntry } from '@napi-rs/keyring'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createIdentity, decodeIdentity, decryptTransfer, describeDevice, encodeIdentity, encryptTransfer,
  pairingCode, readDeviceCard, readEnvelope, readObject, transferLimit } from './transfer'
import type { DeviceCard, DeviceIdentity, TransferEnvelope } from './transfer'
import type { Vault } from './vault'
import type { PairingPreview, SharingDevice, SharingState, TransferPreview } from '../shared/sharing'
import type { SecretMetadata } from '../shared/secrets'

interface Receipt {
  id: string
  digest: string
  projectId: string
  complete: boolean
}

export class Sharing {
  private pending: Promise<void> = Promise.resolve()
  private identity: Promise<DeviceIdentity> | undefined
  private pairing: { token: string; card: DeviceCard } | undefined

  constructor(private readonly root: string, private readonly vault: Vault, private readonly name: string,
    private readonly service = '.sct-sharing') {}

  state(): Promise<SharingState> {
    return this.serialize(async () => {
      const [identity, peers, receipts] = await Promise.all([this.getIdentity(), this.readPeers(), this.readReceipts()])
      const incoming: TransferPreview[] = []
      for (const name of await this.incomingFiles()) {
        const envelope = readEnvelope(await readLimited(join(this.root, 'inbox', name)))
        if (envelope.expiresAt <= Date.now() || receipts.some((receipt) => receipt.id === envelope.id && receipt.complete)) {
          await rm(join(this.root, 'inbox', name))
        } else {
          incoming.push(this.preview(identity, peers, envelope))
        }
      }
      return { device: describeDevice(identity.card), peers: peers.map(describeDevice), incoming }
    })
  }

  deviceCardFile(): Promise<string> {
    return this.serialize(async () => {
      await mkdir(join(this.root, 'outbox'), { recursive: true, mode: 0o700 })
      const path = join(this.root, 'outbox', 'device.sct-device')
      await writeFile(path, JSON.stringify((await this.getIdentity()).card), { mode: 0o600 })
      return path
    })
  }

  previewPeer(path: string): Promise<PairingPreview> {
    return this.serialize(async () => {
      const identity = await this.getIdentity()
      const card = readDeviceCard(await readLimited(path, 4096))
      if (describeDevice(card).id === describeDevice(identity.card).id) throw new Error('This is your own device card. Select the other Mac’s card.')
      this.pairing = { token: randomUUID(), card }
      return { token: this.pairing.token, device: describeDevice(card), code: pairingCode(identity.card, card) }
    })
  }

  confirmPeer(token: unknown): Promise<SharingDevice> {
    return this.serialize(async () => {
      if (typeof token !== 'string' || !this.pairing || token !== this.pairing.token) {
        throw new Error('Open the device card again and compare the pairing code on both Macs.')
      }
      const device = describeDevice(this.pairing.card)
      await this.writeJson('peers.json', { peers: [...(await this.readPeers()).filter((card) => describeDevice(card).id !== device.id), this.pairing.card] })
      this.pairing = undefined
      return device
    })
  }

  exportSecrets(input: unknown): Promise<string> {
    return this.serialize(async () => {
      if (typeof input !== 'object' || input === null || !('projectId' in input) || !('secretIds' in input) || !('recipientId' in input)) {
        throw new Error('Select a project, secrets, and a verified recipient.')
      }
      const recipient = (await this.readPeers()).find((peer) => describeDevice(peer).id === input.recipientId)
      if (!recipient) throw new Error('Verify the recipient device before sharing secrets.')
      const identity = await this.getIdentity()
      const contents = await this.vault.withSelectedSecrets(input.projectId, input.secretIds,
        (project, secrets) => encryptTransfer(identity, recipient, project.name, secrets))
      await mkdir(join(this.root, 'outbox'), { recursive: true, mode: 0o700 })
      const path = join(this.root, 'outbox', `${readEnvelope(contents).id}.sct-transfer`)
      await writeFile(path, contents, { mode: 0o600 })
      return path
    })
  }

  openTransfer(path: string): Promise<TransferPreview> {
    return this.serialize(async () => {
      const envelope = readEnvelope(await readLimited(path))
      const preview = this.preview(await this.getIdentity(), await this.readPeers(), envelope)
      this.requireReceipt(await this.readReceipts(), envelope)
      await mkdir(join(this.root, 'inbox'), { recursive: true, mode: 0o700 })
      const target = join(this.root, 'inbox', `${envelope.id}.sct-transfer`)
      try {
        const existing = readEnvelope(await readLimited(target))
        if (digest(existing) !== digest(envelope)) throw new Error('A different transfer already uses this message ID.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await writeFile(`${target}.tmp`, JSON.stringify(envelope), { mode: 0o600 })
      await rename(`${target}.tmp`, target)
      return preview
    })
  }

  importTransfer(input: unknown): Promise<SecretMetadata[]> {
    return this.serialize(async () => {
      const { transferId, projectId } = requireImport(input)
      const path = join(this.root, 'inbox', `${transferId}.sct-transfer`)
      const envelope = readEnvelope(await readLimited(path))
      const receipts = await this.readReceipts()
      const receipt = this.requireReceipt(receipts, envelope)
      if (receipt && receipt.projectId !== projectId) throw new Error('This import already started in another project. Select its original destination.')
      const sender = requirePeer(await this.readPeers(), envelope.sender)
      const payload = decryptTransfer(await this.getIdentity(), sender, envelope)
      try {
        const saved = await this.vault.importSecrets(projectId, payload.secrets, `${envelope.id}:${digest(envelope)}`, async () => {
          if (!receipt) {
            receipts.push({ id: envelope.id, digest: digest(envelope), projectId, complete: false })
            await this.writeJson('receipts.json', { receipts })
          }
        })
        const completed = receipts.find((entry) => entry.id === envelope.id)
        if (!completed) throw new Error('Cannot find the import receipt. Retry the same transfer and destination.')
        completed.complete = true
        await this.writeJson('receipts.json', { receipts })
        await rm(path)
        return saved
      } finally {
        // JavaScript strings cannot be cleared. Release decrypted values as soon as import finishes.
        payload.secrets.length = 0
      }
    })
  }

  dismissTransfer(id: unknown): Promise<void> {
    return this.serialize(async () => {
      requireTransferId(id)
      await rm(join(this.root, 'inbox', `${id}.sct-transfer`), { force: true })
    })
  }

  async cleanOutbox(): Promise<void> {
    // ShareMenu exposes no transfer-completion event. Keep ciphertext until expiry or app exit.
    for (const name of await readdir(join(this.root, 'outbox')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })) {
      if (name.endsWith('.sct-transfer')) {
        const path = join(this.root, 'outbox', name)
        if (readEnvelope(await readLimited(path)).expiresAt <= Date.now()) await rm(path)
      }
    }
  }

  private async loadIdentity(): Promise<DeviceIdentity> {
    const entry = new AsyncEntry(this.service, this.root)
    const saved = await entry.getSecret()
    if (saved) {
      const bytes = Buffer.from(saved)
      try { return decodeIdentity(bytes) } finally { bytes.fill(0) }
    }
    const identity = createIdentity(this.name)
    const bytes = encodeIdentity(identity)
    try { await entry.setSecret(bytes) } finally { bytes.fill(0) }
    return identity
  }

  private getIdentity(): Promise<DeviceIdentity> {
    this.identity ??= this.loadIdentity().catch(() => {
      this.identity = undefined
      throw new Error('Cannot read the sharing identity. Unlock macOS Keychain and try again.')
    })
    return this.identity
  }

  private preview(identity: DeviceIdentity, peers: DeviceCard[], envelope: TransferEnvelope): TransferPreview {
    const sender = requirePeer(peers, envelope.sender)
    const payload = decryptTransfer(identity, sender, envelope)
    try {
      return { id: envelope.id, sender: describeDevice(sender), projectName: payload.projectName,
        secretNames: payload.secrets.map((secret) => secret.name), expiresAt: new Date(envelope.expiresAt).toISOString() }
    } finally {
      payload.secrets.length = 0
    }
  }

  private requireReceipt(receipts: Receipt[], envelope: TransferEnvelope): Receipt | undefined {
    const receipt = receipts.find((entry) => entry.id === envelope.id)
    if (receipt && receipt.digest !== digest(envelope)) throw new Error('A different transfer already uses this message ID.')
    if (receipt?.complete) throw new Error('This transfer was already imported. No secrets were imported again.')
    return receipt
  }

  private async readPeers(): Promise<DeviceCard[]> {
    const data = await this.readJson('peers.json')
    if (!data) return []
    if (!Array.isArray(data.peers)) throw new Error('The verified device list is invalid.')
    return data.peers.map((card: unknown) => readDeviceCard(Buffer.from(JSON.stringify(card))))
  }

  private async readReceipts(): Promise<Receipt[]> {
    const data = await this.readJson('receipts.json')
    if (!data) return []
    if (!Array.isArray(data.receipts) || !data.receipts.every((entry: unknown): entry is Receipt =>
      typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string' &&
      'digest' in entry && typeof entry.digest === 'string' && 'projectId' in entry && typeof entry.projectId === 'string' &&
      'complete' in entry && typeof entry.complete === 'boolean')) throw new Error('The import receipt list is invalid.')
    return data.receipts
  }

  private async readJson(name: string): Promise<Record<string, unknown> | undefined> {
    try { return readObject(await readFile(join(this.root, name))) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(join(this.root, `${name}.tmp`), JSON.stringify(value), { mode: 0o600 })
    await rename(join(this.root, `${name}.tmp`), join(this.root, name))
  }

  private async incomingFiles(): Promise<string[]> {
    try { return (await readdir(join(this.root, 'inbox'))).filter((name) => name.endsWith('.sct-transfer')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation)
    this.pending = next.then(() => undefined, () => undefined)
    return next
  }
}

function requirePeer(peers: DeviceCard[], id: string): DeviceCard {
  const peer = peers.find((card) => describeDevice(card).id === id)
  if (!peer) throw new Error('Verify the sender’s device card before opening this transfer.')
  return peer
}

function requireImport(input: unknown): { transferId: string; projectId: string } {
  if (typeof input !== 'object' || input === null || !('transferId' in input) || !('projectId' in input) ||
    typeof input.projectId !== 'string' || !input.projectId) throw new Error('Select a received transfer and a destination project.')
  requireTransferId(input.transferId)
  return { transferId: input.transferId, projectId: input.projectId }
}

function requireTransferId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('The transfer ID is invalid.')
  }
}

function digest(envelope: TransferEnvelope): string {
  return createHash('sha256').update(JSON.stringify(envelope)).digest('hex')
}

async function readLimited(path: string, limit = transferLimit): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw new Error('Select a valid .sct file within the transfer size limit.')
    const contents = await file.readFile()
    if (contents.length > limit) throw new Error('The .sct file exceeds the transfer size limit.')
    return contents
  } finally {
    await file.close()
  }
}
