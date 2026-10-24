import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AsyncEntry } from '@napi-rs/keyring'
import { Sharing } from '../src/main/sharing.ts'
import { ProjectStore } from '../src/main/projects.ts'
import { Vault } from '../src/main/vault.ts'
import { createIdentity, decodeIdentity, decryptTransfer, describeDevice, encodeIdentity, encryptTransfer,
  pairingCode, readDeviceCard, readEnvelope, transferLifetime, transferLimit } from '../src/main/transfer.ts'

test('device identities survive encoding and both users compare the same code', () => {
  const alice = createIdentity('Alice')
  const bob = createIdentity('Bob')
  const saved = encodeIdentity(alice)
  try {
    assert.deepEqual(decodeIdentity(saved).card, alice.card)
    assert.deepEqual(readDeviceCard(Buffer.from(JSON.stringify(alice.card))), alice.card)
    assert.equal(pairingCode(alice.card, bob.card), pairingCode(bob.card, alice.card))
    assert.notEqual(pairingCode(alice.card, bob.card), pairingCode(alice.card, createIdentity('Imposter').card))
    assert.notEqual(describeDevice(alice.card).id, describeDevice(bob.card).id)
    assert.throws(() => readDeviceCard(Buffer.from(JSON.stringify({ ...alice.card, signingKey: bob.card.encryptionKey }))))
  } finally { saved.fill(0) }
})

test('recipient encryption hides names and literal values and authenticates every routing field', () => {
  const alice = createIdentity('Alice')
  const bob = createIdentity('Bob')
  const literal = ' spaces "quotes" $dollars = equals\nnext line 🔑'
  const contents = encryptTransfer(alice, bob.card, 'Private project', [
    { name: 'API_TOKEN', value: Buffer.from(literal) }, { name: 'EMPTY', value: Buffer.alloc(0) }
  ])
  assert.ok(!contents.includes(literal) && !contents.includes('API_TOKEN') && !contents.includes('Private project'))
  const envelope = readEnvelope(contents)
  assert.deepEqual(decryptTransfer(bob, alice.card, envelope), {
    projectName: 'Private project', secrets: [{ name: 'API_TOKEN', value: literal }, { name: 'EMPTY', value: '' }]
  })
  assert.throws(() => decryptTransfer(createIdentity('Other'), alice.card, envelope), /different device/)
  assert.throws(() => decryptTransfer(bob, createIdentity('Imposter').card, envelope), /signature/)
  for (const change of [
    { id: randomUUID() }, { sender: describeDevice(bob.card).id }, { recipient: describeDevice(alice.card).id },
    { createdAt: envelope.createdAt - 1 }, { expiresAt: envelope.expiresAt + 1 },
    { ephemeralKey: bob.card.encryptionKey }, { iv: Buffer.alloc(12).toString('base64') },
    { tag: Buffer.alloc(16).toString('base64') }, { ciphertext: Buffer.from('modified').toString('base64') },
    { signature: Buffer.alloc(64).toString('base64') }
  ]) assert.throws(() => decryptTransfer(bob, alice.card, { ...envelope, ...change }))
  assert.throws(() => decryptTransfer(bob, alice.card, envelope, envelope.expiresAt), /expired/)
  assert.throws(() => decryptTransfer(bob, alice.card, envelope, envelope.createdAt - 60_001), /creation time/)
})

test('untrusted packages reject malformed data, invalid names, duplicate names, and unsupported formats', () => {
  const alice = createIdentity('Alice')
  const bob = createIdentity('Bob')
  const valid = readEnvelope(encryptTransfer(alice, bob.card, 'Source', [{ name: 'TOKEN', value: Buffer.from('value') }]))
  for (const value of [null, [], {}, { ...valid, version: 2 }, { ...valid, id: '../escape' },
    { ...valid, iv: '====' }, { ...valid, ephemeralKey: alice.card.signingKey },
    { ...valid, expiresAt: valid.createdAt + transferLifetime + 1 }]) {
    assert.throws(() => readEnvelope(Buffer.from(JSON.stringify(value))))
  }
  assert.throws(() => readEnvelope(Buffer.from('not json')))
  assert.throws(() => readEnvelope(Buffer.alloc(transferLimit + 1)))
  for (const secrets of [[], [{ name: 'BAD-NAME', value: Buffer.from('value') }],
    [{ name: 'TOKEN', value: Buffer.from('value') }, { name: 'TOKEN', value: Buffer.from('other') }],
    [{ name: 'TOKEN', value: Buffer.from('bad\0value') }]]) {
    assert.throws(() => decryptTransfer(bob, alice.card, readEnvelope(encryptTransfer(alice, bob.card, 'Source', secrets))))
  }
})

async function devices(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sct-sharing-')))
  const service = `.sct-transfer-test-${randomUUID()}`
  const instances: { root: string; vault: Vault; sharing: Sharing; projects: ProjectStore }[] = []
  t.after(async () => {
    for (const device of instances) {
      for (const project of await device.projects.list()) await device.vault.deleteProject(project.id)
      await new AsyncEntry(service, join(device.root, 'sharing')).deleteCredential()
    }
    await rm(root, { recursive: true, force: true })
  })
  for (const name of ['sender', 'recipient']) {
    const directory = join(root, name)
    await mkdir(join(directory, 'source'), { recursive: true })
    const projects = new ProjectStore(join(directory, 'projects.json'))
    const vault = new Vault(projects, join(directory, 'settings.json'), directory, service)
    await vault.start()
    instances.push({ root: directory, vault, projects, sharing: new Sharing(join(directory, 'sharing'), vault, name, service) })
  }
  const sender = instances[0]
  const recipient = instances[1]
  assert.ok(sender && recipient)
  const alice = await sender.sharing.previewPeer(await recipient.sharing.deviceCardFile())
  const bob = await recipient.sharing.previewPeer(await sender.sharing.deviceCardFile())
  assert.equal(alice.code, bob.code)
  await assert.rejects(sender.sharing.confirmPeer('wrong token'))
  await sender.sharing.confirmPeer(alice.token)
  await recipient.sharing.confirmPeer(bob.token)
  return { sender, recipient, service }
}

test('selected secrets enter only the chosen project with fresh local keys and a durable replay record', async (t) => {
  const { sender, recipient, service } = await devices(t)
  const source = await sender.vault.addProject({ name: 'Backend', directory: join(sender.root, 'source') })
  const target = await recipient.vault.addProject({ name: 'API', directory: join(recipient.root, 'source') })
  await mkdir(join(recipient.root, 'other'))
  const other = await recipient.vault.addProject({ name: 'Other', directory: join(recipient.root, 'other') })
  const secret = await sender.vault.addSecret({ projectId: source.id, name: 'TOKEN', value: ' private $literal\nvalue ' })
  await sender.vault.addSecret({ projectId: source.id, name: 'UNSELECTED', value: 'must stay local' })
  const recipientId = (await recipient.sharing.state()).device.id
  await assert.rejects(sender.sharing.exportSecrets({ projectId: source.id, secretIds: [secret.id], recipientId: 'unverified' }), /Verify/)
  let held: Buffer | undefined
  await sender.vault.withSelectedSecrets(source.id, [secret.id], (_project, values) => { held = values[0]?.value })
  assert.ok(held?.every((byte) => byte === 0))
  const file = await sender.sharing.exportSecrets({ projectId: source.id, secretIds: [secret.id], recipientId })
  const bytes = await readFile(file)
  assert.ok(!bytes.includes('TOKEN') && !bytes.includes('private') && !bytes.includes('UNSELECTED'))
  const preview = await recipient.sharing.openTransfer(file)
  assert.deepEqual(preview.secretNames, ['TOKEN'])
  assert.deepEqual((await recipient.sharing.state()).incoming, [preview])
  assert.ok(!JSON.stringify(preview).includes('private'))

  const imported = await recipient.sharing.importTransfer({ transferId: preview.id, projectId: target.id })
  assert.equal(imported.length, 1)
  assert.ok(imported[0])
  await recipient.vault.withSecret(imported[0], (value) => assert.equal(value.toString(), ' private $literal\nvalue '))
  assert.deepEqual((await recipient.vault.listSecrets()).filter((entry) => entry.projectId === other.id), [])
  const encrypted = await readFile(join(recipient.root, '.sct', target.name, 'secrets.sct'))
  assert.ok(!encrypted.includes('TOKEN') && !encrypted.includes('private'))
  assert.equal((await recipient.sharing.state()).incoming.length, 0)
  assert.deepEqual(await readdir(join(recipient.root, 'sharing', 'inbox')), [])
  const reopened = new Sharing(join(recipient.root, 'sharing'), recipient.vault, 'recipient', service)
  await assert.rejects(reopened.openTransfer(file), /already imported/)
  assert.equal((await recipient.vault.listSecrets()).length, 1)
  await assert.rejects(reopened.dismissTransfer('../escape'), /invalid/)
})

test('batch conflicts leave all existing secrets intact and permit another destination', async (t) => {
  const { sender, recipient } = await devices(t)
  const source = await sender.vault.addProject({ name: 'Source', directory: join(sender.root, 'source') })
  const destination = await recipient.vault.addProject({ name: 'Destination', directory: join(recipient.root, 'source') })
  const conflict = await recipient.vault.addSecret({ projectId: destination.id, name: 'TOKEN', value: 'existing' })
  const selected = [await sender.vault.addSecret({ projectId: source.id, name: 'FIRST', value: '' }),
    await sender.vault.addSecret({ projectId: source.id, name: 'TOKEN', value: 'new' })]
  const file = await sender.sharing.exportSecrets({ projectId: source.id, secretIds: selected.map((entry) => entry.id),
    recipientId: (await recipient.sharing.state()).device.id })
  const preview = await recipient.sharing.openTransfer(file)
  await assert.rejects(recipient.sharing.importTransfer({ transferId: preview.id, projectId: destination.id }), /already exists/)
  assert.deepEqual(await recipient.vault.listSecrets(), [conflict])
  await recipient.vault.withSecret(conflict, (value) => assert.equal(value.toString(), 'existing'))
  await mkdir(join(recipient.root, 'fresh'))
  const fresh = await recipient.vault.addProject({ name: 'Fresh', directory: join(recipient.root, 'fresh') })
  const imported = await recipient.sharing.importTransfer({ transferId: preview.id, projectId: fresh.id })
  assert.equal(imported.length, 2)
})

test('recovery after a vault commit reuses the original destination and does not duplicate imports', async (t) => {
  const { sender, recipient, service } = await devices(t)
  const source = await sender.vault.addProject({ name: 'Source', directory: join(sender.root, 'source') })
  const target = await recipient.vault.addProject({ name: 'Target', directory: join(recipient.root, 'source') })
  const secret = await sender.vault.addSecret({ projectId: source.id, name: 'TOKEN', value: 'secret' })
  const file = await sender.sharing.exportSecrets({ projectId: source.id, secretIds: [secret.id], recipientId: (await recipient.sharing.state()).device.id })
  const preview = await recipient.sharing.openTransfer(file)
  const first = await recipient.sharing.importTransfer({ transferId: preview.id, projectId: target.id })
  // Reproduce a crash after vault commit but before the completion receipt reaches disk.
  const receiptFile = join(recipient.root, 'sharing', 'receipts.json')
  const receipts = JSON.parse(await readFile(receiptFile, 'utf8')) as { receipts: { complete: boolean }[] }
  for (const entry of receipts.receipts) entry.complete = false
  await writeFile(receiptFile, JSON.stringify(receipts))
  const reopened = new Sharing(join(recipient.root, 'sharing'), recipient.vault, 'recipient', service)
  await reopened.openTransfer(file)
  await assert.rejects(reopened.importTransfer({ transferId: preview.id, projectId: 'different' }), /original destination/)
  assert.deepEqual(await reopened.importTransfer({ transferId: preview.id, projectId: target.id }), first)
  assert.equal((await recipient.vault.listSecrets()).length, 1)
})
