import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { AsyncEntry } from '@napi-rs/keyring'
import { ProjectStore } from '../src/main/projects.ts'
import { Vault } from '../src/main/vault.ts'

// Each test uses real macOS Keychain under its own service, and removes every item that it created.
async function setup(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sct-vault-')))
  const service = `.sct-test-${randomUUID()}`
  const accounts: string[] = []
  const open = async () => {
    const projects = new ProjectStore(join(root, 'app-data', 'projects.json'))
    const vault = new Vault(projects, join(root, 'app-data', 'settings.json'), root, service)
    await vault.start()
    return vault
  }
  const keychainKey = (account: string) => {
    accounts.push(account)
    return new AsyncEntry(service, account).getSecret()
  }
  const folder = async (name: string) => {
    const directory = join(root, 'folders', name)
    await mkdir(directory, { recursive: true })
    return directory
  }
  t.after(async () => {
    const vault = await open()
    for (const project of await new ProjectStore(join(root, 'app-data', 'projects.json')).list()) {
      await vault.deleteProject(project.id).catch(() => undefined)
    }
    for (const account of accounts) await new AsyncEntry(service, account).deleteCredential()
    await rm(root, { recursive: true, force: true })
  })
  return { root, open, keychainKey, folder }
}

test('secrets are encrypted at rest and only metadata leaves the vault', async (t) => {
  const { root, open, keychainKey, folder } = await setup(t)
  const vault = await open()
  assert.equal(vault.location(), join(root, '.sct'))
  const project = await vault.addProject({ name: 'Demo', directory: await folder('demo') })
  assert.ok((await stat(join(root, '.sct', 'Demo'))).isDirectory())

  const value = `sk-${randomUUID()}`
  const secret = await vault.addSecret({ projectId: project.id, name: 'OPENAI_API_KEY', value })
  assert.deepEqual(Object.keys(secret).sort(), ['id', 'name', 'projectId'])
  const file = await readFile(join(root, '.sct', 'Demo', 'secrets.sct'))
  assert.equal(file.subarray(0, 4).toString(), 'SCT1')
  assert.ok(!file.includes(value) && !file.includes('OPENAI_API_KEY'))
  assert.ok(await keychainKey(`${project.id}/file`))
  assert.ok(await keychainKey(`${project.id}/${secret.id}`))

  assert.deepEqual(await (await open()).listSecrets(), [secret])
  await vault.updateSecret({ projectId: project.id, id: secret.id, value: `${value}-new` })
  assert.notDeepEqual(await readFile(join(root, '.sct', 'Demo', 'secrets.sct')), file)
  assert.deepEqual(await vault.listSecrets(), [secret])

  await vault.deleteSecret({ projectId: project.id, id: secret.id })
  assert.deepEqual(await vault.listSecrets(), [])
  assert.equal(await keychainKey(`${project.id}/${secret.id}`), null)
})

test('invalid secrets and duplicate names do not change the vault', async (t) => {
  const { open, folder } = await setup(t)
  const vault = await open()
  const project = await vault.addProject({ name: 'Demo', directory: await folder('demo') })
  const secret = await vault.addSecret({ projectId: project.id, name: 'TOKEN', value: 'one' })
  await assert.rejects(vault.addSecret({ projectId: project.id, name: 'TOKEN', value: 'two' }), /already exists/)
  for (const input of [null, {}, { projectId: project.id, name: '1TOKEN', value: 'x' },
    { projectId: project.id, name: 'BAD-NAME', value: 'x' }, { projectId: project.id, name: 'EMPTY', value: '' },
    { projectId: 'missing', name: 'OTHER', value: 'x' }]) {
    await assert.rejects(vault.addSecret(input))
  }
  await assert.rejects(vault.updateSecret({ projectId: project.id, id: 'missing', value: 'x' }), /does not exist/)
  assert.deepEqual(await vault.listSecrets(), [secret])
})

test('project names cannot leave the vault folder or repeat', async (t) => {
  const { root, open, folder } = await setup(t)
  const vault = await open()
  for (const name of ['..', '.', '.hidden', '../outside', 'a/b', 'a\\b', 'a:b']) {
    await assert.rejects(vault.addProject({ name, directory: await folder('traversal') }))
  }
  await vault.addProject({ name: 'Demo', directory: await folder('demo') })
  await assert.rejects(vault.addProject({ name: 'demo', directory: await folder('other') }), /already exists/)
  assert.deepEqual(await readdir(join(root, '.sct')), ['Demo'])
  assert.deepEqual((await readdir(root)).sort(), ['.sct', 'app-data', 'folders'])
})

test('renaming a project moves its secrets, and deleting it removes its files and Keychain items', async (t) => {
  const { root, open, keychainKey, folder } = await setup(t)
  const vault = await open()
  const directory = await folder('demo')
  const project = await vault.addProject({ name: 'Demo', directory })
  const secret = await vault.addSecret({ projectId: project.id, name: 'TOKEN', value: 'value' })

  await vault.renameProject({ id: project.id, name: 'Renamed' })
  assert.deepEqual(await readdir(join(root, '.sct')), ['Renamed'])
  assert.deepEqual(await vault.listSecrets(), [secret])

  await mkdir(join(root, '.sct', 'Taken', 'unrelated'), { recursive: true })
  await assert.rejects(vault.renameProject({ id: project.id, name: 'Taken' }), /already contains a folder named Taken/)
  await rm(join(root, '.sct', 'Taken'), { recursive: true })
  await vault.renameProject({ id: project.id, name: 'renamed' })
  assert.deepEqual(await readdir(join(root, '.sct')), ['renamed'])
  assert.deepEqual(await vault.listSecrets(), [secret])

  await vault.deleteProject(project.id)
  assert.deepEqual(await readdir(join(root, '.sct')), [])
  assert.equal(await keychainKey(`${project.id}/${secret.id}`), null)
  assert.equal(await keychainKey(`${project.id}/file`), null)
  assert.ok((await stat(directory)).isDirectory())
})

test('startup creates folders for existing projects and skips names that are not valid folder names', async (t) => {
  const { root, open, folder } = await setup(t)
  await mkdir(join(root, 'app-data'))
  await writeFile(join(root, 'app-data', 'projects.json'), JSON.stringify([
    { id: 'existing', name: 'Existing', directory: await folder('existing') },
    { id: 'older', name: 'older/name', directory: await folder('older') }
  ]))
  await open()
  assert.deepEqual(await readdir(join(root, '.sct')), ['Existing'])
})

test('a secrets file copied into a different project does not open', async (t) => {
  const { root, open, keychainKey, folder } = await setup(t)
  const vault = await open()
  const first = await vault.addProject({ name: 'First', directory: await folder('first') })
  const second = await vault.addProject({ name: 'Second', directory: await folder('second') })
  await vault.addSecret({ projectId: first.id, name: 'TOKEN', value: 'value' })
  const other = await vault.addSecret({ projectId: second.id, name: 'OTHER', value: 'value' })
  await copyFile(join(root, '.sct', 'First', 'secrets.sct'), join(root, '.sct', 'Second', 'secrets.sct'))
  await assert.rejects(vault.listSecrets(), /different project/)
  // Second cannot open its file now, so cleanup cannot delete it. These calls record its Keychain items for removal.
  assert.ok(await keychainKey(`${second.id}/file`))
  assert.ok(await keychainKey(`${second.id}/${other.id}`))
})

test('moving the storage location moves the vault and persists after restart', async (t) => {
  const { root, open, folder } = await setup(t)
  const vault = await open()
  const project = await vault.addProject({ name: 'Demo', directory: await folder('demo') })
  const secret = await vault.addSecret({ projectId: project.id, name: 'TOKEN', value: 'value' })
  const target = await folder('new-root')

  assert.equal(await vault.moveTo(target), join(target, '.sct'))
  await assert.rejects(stat(join(root, '.sct')))
  const restarted = await open()
  assert.equal(restarted.location(), join(target, '.sct'))
  assert.deepEqual(await restarted.listSecrets(), [secret])

  await mkdir(join(root, 'occupied', '.sct'), { recursive: true })
  await assert.rejects(restarted.moveTo(join(root, 'occupied')), /already contains/)
  await assert.rejects(restarted.moveTo(join(target, '.sct', 'Demo')), /outside/)
  assert.equal(restarted.location(), join(target, '.sct'))
})
