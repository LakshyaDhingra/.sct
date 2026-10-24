import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server'
import type { Identity } from 'spacetimedb'

// All tables are private. Clients read rows only through the views below.
// The relay never reads payload or wrappedKey. Issue #16 defines their contents.

const PairStatus = t.enum('PairStatus', { Pending: t.unit(), Verified: t.unit() })
const DeliveryStatus = t.enum('DeliveryStatus', { Pending: t.unit(), Received: t.unit() })

const device = table(
  { name: 'device' },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    encryptionPublicKey: t.byteArray(),
    signingPublicKey: t.byteArray(),
    registeredAt: t.timestamp()
  }
)

const pair = table(
  {
    name: 'pair',
    indexes: [
      { accessor: 'byInitiatorPeer', algorithm: 'btree', columns: ['initiator', 'peer'] },
      { accessor: 'byPeerInitiator', algorithm: 'btree', columns: ['peer', 'initiator'] }
    ]
  },
  {
    id: t.u64().primaryKey().autoInc(),
    initiator: t.identity(),
    peer: t.identity(),
    status: PairStatus
  }
)

const message = table(
  { name: 'message' },
  {
    id: t.string().primaryKey(),
    sender: t.identity().index('btree'),
    payload: t.byteArray(),
    createdAt: t.timestamp()
  }
)

const delivery = table(
  {
    name: 'delivery',
    indexes: [
      { accessor: 'byMessageRecipient', algorithm: 'btree', columns: ['messageId', 'recipient'] },
      { accessor: 'byRecipientMessage', algorithm: 'btree', columns: ['recipient', 'messageId'] }
    ]
  },
  {
    id: t.u64().primaryKey().autoInc(),
    messageId: t.string(),
    recipient: t.identity(),
    wrappedKey: t.byteArray(),
    status: DeliveryStatus,
    receivedAt: t.option(t.timestamp())
  }
)

const spacetimedb = schema({ device, pair, message, delivery })
export default spacetimedb

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>

const RecipientKey = t.object('RecipientKey', { recipient: t.identity(), wrappedKey: t.byteArray() })

export const registerDevice = spacetimedb.reducer(
  { name: t.string(), encryptionPublicKey: t.byteArray(), signingPublicKey: t.byteArray() },
  (ctx, { name, encryptionPublicKey, signingPublicKey }) => {
    if (!name.trim()) throw new SenderError('The device name is empty.')
    if (!encryptionPublicKey.length || !signingPublicKey.length) throw new SenderError('A device public key is empty.')
    const existing = ctx.db.device.identity.find(ctx.sender)
    if (!existing) {
      ctx.db.device.insert({ identity: ctx.sender, name, encryptionPublicKey, signingPublicKey, registeredAt: ctx.timestamp })
      return
    }
    // Paired devices trust the registered keys. A key change needs a new identity and a new pairing.
    if (!sameBytes(existing.encryptionPublicKey, encryptionPublicKey) || !sameBytes(existing.signingPublicKey, signingPublicKey)) {
      throw new SenderError('The device keys cannot change.')
    }
    ctx.db.device.identity.update({ ...existing, name })
  }
)

export const requestPair = spacetimedb.reducer({ peer: t.identity() }, (ctx, { peer }) => {
  requireDevice(ctx, ctx.sender)
  if (peer.equals(ctx.sender)) throw new SenderError('A device cannot pair with itself.')
  requireDevice(ctx, peer)
  if (findPair(ctx, ctx.sender, peer)) throw new SenderError('These devices already have a pair.')
  ctx.db.pair.insert({ id: 0n, initiator: ctx.sender, peer, status: { tag: 'Pending' } })
})

// Issue #15 adds the pairing code check in the app before the peer confirms.
export const confirmPair = spacetimedb.reducer({ pairId: t.u64() }, (ctx, { pairId }) => {
  const row = ctx.db.pair.id.find(pairId)
  if (!row || !row.peer.equals(ctx.sender)) throw new SenderError('No pair request exists for this device.')
  if (row.status.tag === 'Verified') return
  ctx.db.pair.id.update({ ...row, status: { tag: 'Verified' } })
})

export const publishSecret = spacetimedb.reducer(
  { id: t.string(), payload: t.byteArray(), recipients: t.array(RecipientKey) },
  (ctx, { id, payload, recipients }) => {
    requireDevice(ctx, ctx.sender)
    if (!id) throw new SenderError('The message ID is empty.')
    if (!payload.length) throw new SenderError('The message payload is empty.')
    if (ctx.db.message.id.find(id)) throw new SenderError('The message ID is already used.')
    requireRecipients(ctx, recipients)
    ctx.db.message.insert({ id, sender: ctx.sender, payload, createdAt: ctx.timestamp })
    for (const { recipient, wrappedKey } of recipients) {
      ctx.db.delivery.insert({ id: 0n, messageId: id, recipient, wrappedKey, status: { tag: 'Pending' }, receivedAt: undefined })
    }
  }
)

// The recipient app protects the secret locally before it calls this reducer.
export const acknowledge = spacetimedb.reducer({ messageId: t.string() }, (ctx, { messageId }) => {
  const [row] = ctx.db.delivery.byMessageRecipient.filter([messageId, ctx.sender])
  if (!row) throw new SenderError('No delivery exists for this device.')
  if (row.status.tag === 'Received') return
  ctx.db.delivery.id.update({ ...row, status: { tag: 'Received' }, receivedAt: ctx.timestamp })
})

export const myInbox = spacetimedb.view(
  { name: 'my_inbox', public: true },
  t.array(t.object('InboxItem', {
    messageId: t.string(),
    sender: t.identity(),
    payload: t.byteArray(),
    wrappedKey: t.byteArray(),
    createdAt: t.timestamp()
  })),
  (ctx) => [...ctx.db.delivery.byRecipientMessage.filter(ctx.sender)]
    .filter((row) => row.status.tag === 'Pending')
    .flatMap((row) => {
      const sent = ctx.db.message.id.find(row.messageId)
      return sent
        ? [{ messageId: sent.id, sender: sent.sender, payload: sent.payload, wrappedKey: row.wrappedKey, createdAt: sent.createdAt }]
        : []
    })
)

export const mySent = spacetimedb.view(
  { name: 'my_sent', public: true },
  t.array(t.object('SentItem', {
    messageId: t.string(),
    recipient: t.identity(),
    status: DeliveryStatus,
    receivedAt: t.option(t.timestamp())
  })),
  (ctx) => [...ctx.db.message.sender.filter(ctx.sender)].flatMap((sent) =>
    [...ctx.db.delivery.byMessageRecipient.filter(sent.id)].map((row) => ({
      messageId: sent.id,
      recipient: row.recipient,
      status: row.status,
      receivedAt: row.receivedAt
    }))
  )
)

export const myPeers = spacetimedb.view(
  { name: 'my_peers', public: true },
  t.array(t.object('PeerItem', {
    pairId: t.u64(),
    status: PairStatus,
    identity: t.identity(),
    name: t.string(),
    encryptionPublicKey: t.byteArray(),
    signingPublicKey: t.byteArray()
  })),
  (ctx) => [
    ...[...ctx.db.pair.byInitiatorPeer.filter(ctx.sender)].map((row) => ({ row, other: row.peer })),
    ...[...ctx.db.pair.byPeerInitiator.filter(ctx.sender)].map((row) => ({ row, other: row.initiator }))
  ].flatMap(({ row, other }) => {
    const peer = ctx.db.device.identity.find(other)
    return peer
      ? [{
          pairId: row.id,
          status: row.status,
          identity: peer.identity,
          name: peer.name,
          encryptionPublicKey: peer.encryptionPublicKey,
          signingPublicKey: peer.signingPublicKey
        }]
      : []
  })
)

function requireDevice(ctx: Ctx, identity: Identity) {
  if (!ctx.db.device.identity.find(identity)) throw new SenderError('The device is not registered.')
}

function findPair(ctx: Ctx, first: Identity, second: Identity) {
  const [row] = [...ctx.db.pair.byInitiatorPeer.filter([first, second]), ...ctx.db.pair.byInitiatorPeer.filter([second, first])]
  return row
}

function requireRecipients(ctx: Ctx, recipients: { recipient: Identity; wrappedKey: Uint8Array }[]) {
  if (!recipients.length) throw new SenderError('The message has no recipients.')
  const seen = new Set<string>()
  for (const { recipient, wrappedKey } of recipients) {
    const key = recipient.toHexString()
    if (seen.has(key)) throw new SenderError('A recipient occurs more than one time.')
    seen.add(key)
    if (!wrappedKey.length) throw new SenderError('A wrapped key is empty.')
    if (findPair(ctx, ctx.sender, recipient)?.status.tag !== 'Verified') {
      throw new SenderError('A recipient has no verified pair with this device.')
    }
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
