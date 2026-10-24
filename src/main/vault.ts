import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isProjectName } from './projects.ts'
import type { ProjectStore } from './projects.ts'
import type { Project } from '../shared/projects.ts'
import type { SecretMetadata } from '../shared/secrets.ts'
import type { TransferSecret } from './transfer.ts'
import { decodeFile, encodeFile, open, seal } from './seal.ts'
import type { Sealed } from './seal.ts'

// secrets.sct layout: magic | IV | GCM tag | ciphertext. The ciphertext holds names and individually encrypted values.
const magic = Buffer.from('SCT1')
const vaultDirectoryName = '.sct'
const secretsFileName = 'secrets.sct'

interface StoredSecret {
  id: string
  name: string
  iv: string
  tag: string
  value: string
  transferId?: string
}

export class Vault {
  private pending: Promise<void> = Promise.resolve()
  private root = ''
  private readonly projects: ProjectStore
  private readonly settingsFile: string
  private readonly defaultRoot: string
  private readonly service: string

  constructor(projects: ProjectStore, settingsFile: string, defaultRoot: string, service = '.sct') {
    this.projects = projects
    this.settingsFile = settingsFile
    this.defaultRoot = defaultRoot
    this.service = service
  }

  async start(): Promise<void> {
    this.root = await this.readRoot()
    try {
      await mkdir(this.location(), { recursive: true, mode: 0o700 })
      await this.createProjectDirectories()
    } catch (error) {
      throw new Error(`Cannot create the vault folders at ${this.location()}.`, { cause: error })
    }
  }

  location(): string {
    return join(this.root, vaultDirectoryName)
  }

  moveTo(root: unknown): Promise<string> {
    return this.serialize(async () => {
      const newRoot = await requireDirectory(root)
      const current = this.location()
      const target = join(newRoot, vaultDirectoryName)
      if (target === current) return current
      if (target.startsWith(`${current}${sep}`)) throw new Error('Select a folder outside the current .sct folder.')
      if (await exists(target)) throw new Error('The selected folder already contains a .sct folder. Select a different folder.')

      await moveDirectory(current, target)
      try {
        await writeJson(this.settingsFile, { vaultRoot: newRoot })
      } catch (error) {
        await moveDirectory(target, current)
        throw new Error('Cannot save the new storage location. The vault stays in its previous folder.', { cause: error })
      }
      this.root = newRoot
      return target
    })
  }

  addProject(input: unknown): Promise<Project> {
    return this.serialize(async () => {
      const project = await this.projects.add(input)
      await mkdir(this.projectDirectory(project.name), { recursive: true, mode: 0o700 })
      return project
    })
  }

  renameProject(input: unknown): Promise<Project> {
    return this.serialize(() => this.projects.rename(input, async (project, name) => {
      const from = this.projectDirectory(project.name)
      const to = this.projectDirectory(name)
      if (!(await exists(from))) return
      // macOS ignores letter case, so a rename from "App" to "app" finds its own folder at the new path.
      if (from.toLowerCase() !== to.toLowerCase() && await exists(to)) {
        throw new Error(`The vault already contains a folder named ${name}. Move or remove that folder, then try again.`)
      }
      try {
        await rename(from, to)
      } catch (error) {
        throw new Error(`Cannot rename the vault folder of ${project.name}. Check the folder permissions.`, { cause: error })
      }
    }))
  }

  // Deletes the project's vault directory and Keychain items. The project folder itself stays unchanged.
  deleteProject(id: unknown): Promise<void> {
    return this.serialize(() => this.projects.remove(id, async (project) => {
      const secrets = await this.readSecrets(project)
      let remaining = secrets
      for (const secret of secrets) remaining = await this.removeSecret(project, remaining, secret.id)
      await rm(this.projectDirectory(project.name), { recursive: true, force: true })
      await this.entry(project, 'file').deleteCredential()
    }))
  }

  listSecrets(): Promise<SecretMetadata[]> {
    return this.serialize(async () => {
      const secrets: SecretMetadata[] = []
      for (const project of await this.projects.list()) {
        for (const { id, name } of await this.readSecrets(project)) secrets.push({ id, projectId: project.id, name })
      }
      return secrets
    })
  }

  addSecret(input: unknown): Promise<SecretMetadata> {
    return this.serialize(async () => {
      const { projectId, name, value } = requireSecretInput(input)
      const project = await this.projects.find(projectId)
      const secrets = await this.readSecrets(project)
      if (secrets.some((secret) => secret.name === name)) {
        throw new Error(`${name} already exists in ${project.name}. Delete it first, or update its value.`)
      }

      const id = randomUUID()
      const key = randomBytes(32)
      await this.entry(project, id).setSecret(key)
      try {
        await this.writeSecrets(project, [...secrets, { id, name, ...encodeSealed(seal(key, Buffer.from(value), valueData(project, id))) }])
      } catch (error) {
        await this.entry(project, id).deleteCredential()
        throw error
      }
      return { id, projectId: project.id, name }
    })
  }

  updateSecret(input: unknown): Promise<SecretMetadata> {
    return this.serialize(async () => {
      const { projectId, id, value } = requireSecretUpdate(input)
      const project = await this.projects.find(projectId)
      const secrets = await this.readSecrets(project)
      const secret = requireSecret(secrets, id)
      const key = await this.readKey(project, secret.id)
      const updated = { ...secret, ...encodeSealed(seal(key, Buffer.from(value), valueData(project, secret.id))) }
      await this.writeSecrets(project, secrets.map((saved) => saved.id === secret.id ? updated : saved))
      return { id: secret.id, projectId: project.id, name: secret.name }
    })
  }

  // Main-process consumers must not retain or return plaintext. No IPC handler exposes this method.
  withSecret<T>(input: unknown, use: (value: Buffer) => T | Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const { projectId, id } = requireSecretReference(input)
      const project = await this.projects.find(projectId)
      const value = await this.decryptSecret(project, requireSecret(await this.readSecrets(project), id))
      try {
        return await use(value)
      } finally {
        value.fill(0)
      }
    })
  }

  withSelectedSecrets<T>(projectId: unknown, ids: unknown,
    use: (project: Project, secrets: { name: string; value: Buffer }[]) => T | Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const selected = requireSecretIds(ids)
      const project = await this.projects.find(projectId)
      const stored = await this.readSecrets(project)
      const values: { name: string; value: Buffer }[] = []
      try {
        const reads = await Promise.allSettled(selected.map(async (id) => {
          const secret = requireSecret(stored, id)
          return { name: secret.name, value: await this.decryptSecret(project, secret) }
        }))
        for (const read of reads) if (read.status === 'fulfilled') values.push(read.value)
        for (const read of reads) if (read.status === 'rejected') throw read.reason
        return await use(project, values)
      } finally {
        for (const secret of values) secret.value.fill(0)
      }
    })
  }

  // One encrypted file commit prevents a failed batch from leaving half the transfer in the vault.
  importSecrets(projectId: unknown, input: readonly TransferSecret[], transferId: string,
    beforeWrite: () => Promise<void>): Promise<SecretMetadata[]> {
    return this.serialize(async () => {
      const project = await this.projects.find(projectId)
      const incoming = input.map((entry) => requireSecretInput({ ...entry, projectId: project.id }))
      if (!incoming.length || new Set(incoming.map((entry) => entry.name)).size !== incoming.length) {
        throw new Error('The transfer contains no secrets or contains duplicate names.')
      }
      const stored = await this.readSecrets(project)
      const imported = stored.filter((secret) => secret.transferId === transferId)
      if (imported.length) {
        if (imported.length !== incoming.length || incoming.some((entry) => !imported.some((secret) => secret.name === entry.name))) {
          throw new Error('This transfer was already imported and its secrets changed. No secrets were imported again.')
        }
        return imported.map(({ id, name }) => ({ id, name, projectId: project.id }))
      }
      for (const entry of incoming) {
        if (stored.some((secret) => secret.name === entry.name)) {
          throw new Error(`${entry.name} already exists in ${project.name}. Choose another project or resolve the name conflict first.`)
        }
      }
      await beforeWrite()
      const added: StoredSecret[] = []
      try {
        const writes = await Promise.allSettled(incoming.map(async (entry) => {
          const id = randomUUID()
          const key = randomBytes(32)
          const plaintext = Buffer.from(entry.value)
          try {
            const sealed = encodeSealed(seal(key, plaintext, valueData(project, id)))
            await this.entry(project, id).setSecret(key)
            added.push({ id, name: entry.name, transferId, ...sealed })
          } finally {
            key.fill(0)
            plaintext.fill(0)
          }
        }))
        for (const write of writes) if (write.status === 'rejected') throw write.reason
        await this.writeSecrets(project, [...stored, ...added])
      } catch (error) {
        const removed = await Promise.allSettled(added.map((secret) => this.entry(project, secret.id).deleteCredential()))
        if (removed.some((result) => result.status === 'rejected')) {
          throw new Error('Import failed. Some unused Keychain keys could not be removed. Unlock Keychain before retrying.', { cause: error })
        }
        throw error
      }
      return added.map(({ id, name }) => ({ id, name, projectId: project.id }))
    })
  }

  // The callback starts the child before this method removes its environment references.
  withProjectEnvironment<T>(projectId: string, use: (project: Project, environment: NodeJS.ProcessEnv) => T | Promise<T>): Promise<T> {
    return this.withProjectSecrets(projectId, async (project, values) => {
      const environment = { ...process.env, ...values }
      try {
        return await use(project, environment)
      } finally {
        for (const name of Object.keys(environment)) delete environment[name]
      }
    })
  }

  projectRevision(projectId: string): Promise<string> {
    return this.serialize(async () => {
      this.root = await this.readRoot()
      const project = await this.projects.find(projectId)
      const file = await stat(join(this.projectDirectory(project.name), secretsFileName))
      return JSON.stringify([project.name, project.directory, this.root, file.ino, file.mtimeMs, file.ctimeMs, file.size])
    })
  }

  // Trusted local consumers receive only this project's values, never the inherited environment.
  withProjectSecrets<T>(projectId: string, use: (project: Project, values: Record<string, string>) => T | Promise<T>): Promise<T> {
    return this.serialize(async () => {
      this.root = await this.readRoot()
      const project = await this.projects.find(projectId)
      const storage = relative(project.directory, this.location())
      if (!isAbsolute(storage) && storage !== '..' && !storage.startsWith(`..${sep}`)) {
        throw new Error('Move vault storage outside the project folder before launch.')
      }
      const environment: Record<string, string> = {}
      try {
        const reads = await Promise.allSettled((await this.readSecrets(project, true)).map(
          (secret) => this.addEnvironmentSecret(project, secret, environment)
        ))
        // Complete all reads before cleanup, including when one key is unavailable.
        for (const read of reads) if (read.status === 'rejected') throw read.reason
        return await use(project, environment)
      } finally {
        for (const name of Object.keys(environment)) delete environment[name]
      }
    })
  }

  deleteSecret(input: unknown): Promise<void> {
    return this.serialize(async () => {
      const { projectId, id } = requireSecretReference(input)
      const project = await this.projects.find(projectId)
      await this.removeSecret(project, await this.readSecrets(project), id)
    })
  }

  private async decryptSecret(project: Project, secret: StoredSecret): Promise<Buffer> {
    const key = await this.readKey(project, secret.id)
    try {
      return open(key, {
        iv: Buffer.from(secret.iv, 'base64'),
        tag: Buffer.from(secret.tag, 'base64'),
        ciphertext: Buffer.from(secret.value, 'base64')
      }, valueData(project, secret.id))
    } catch (error) {
      throw new Error('Cannot decrypt this secret. Its encrypted value or Keychain key is invalid.', { cause: error })
    } finally {
      key.fill(0)
    }
  }

  private async addEnvironmentSecret(project: Project, secret: StoredSecret, environment: NodeJS.ProcessEnv): Promise<void> {
    if (!isSecretName(secret.name)) throw new Error('A stored secret name is invalid for the process environment.')
    const value = await this.decryptSecret(project, secret)
    try {
      const plaintext = value.toString('utf8')
      if (!isSecretValue(plaintext)) throw new Error('A stored secret value is invalid for the process environment.')
      // defineProperty also supports valid names such as __proto__.
      Object.defineProperty(environment, secret.name, { value: plaintext, enumerable: true, configurable: true })
    } finally {
      value.fill(0)
    }
  }

  private async removeSecret(project: Project, secrets: StoredSecret[], id: string): Promise<StoredSecret[]> {
    const secret = requireSecret(secrets, id)
    const remaining = secrets.filter((saved) => saved.id !== secret.id)
    const contents = await readFile(join(this.projectDirectory(project.name), secretsFileName))
    await this.writeSecrets(project, remaining)
    try {
      await this.entry(project, secret.id).deleteCredential()
    } catch (error) {
      // Restore encrypted bytes without Keychain access, because Keychain can be locked after the file changes.
      await this.writeSecretsFile(project, contents)
      throw new Error('Cannot delete the Keychain key. The secret remains saved. Unlock Keychain and try again.', { cause: error })
    }
    return remaining
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  // Projects from earlier versions get their folder here. The Projects screen reports an unreadable list,
  // and an older name that is not a valid folder name stays without a folder until the user renames it.
  private async createProjectDirectories(): Promise<void> {
    let projects: Project[]
    try {
      projects = await this.projects.list()
    } catch {
      return
    }
    for (const project of projects.filter((saved) => isProjectName(saved.name))) {
      await mkdir(this.projectDirectory(project.name), { recursive: true, mode: 0o700 })
    }
  }

  private async readRoot(): Promise<string> {
    let contents: string
    try {
      contents = await readFile(this.settingsFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.defaultRoot
      throw new Error('Cannot read the storage settings.', { cause: error })
    }
    let settings: unknown
    try {
      settings = JSON.parse(contents)
    } catch (error) {
      throw new Error('The storage settings are invalid. .sct did not change them.', { cause: error })
    }
    if (typeof settings !== 'object' || settings === null || !('vaultRoot' in settings) ||
      typeof settings.vaultRoot !== 'string' || !isAbsolute(settings.vaultRoot)) {
      throw new Error('The storage settings are invalid. .sct did not change them.')
    }
    return settings.vaultRoot
  }

  // Validates the name again and checks that the result stays one level below the vault folder.
  private projectDirectory(name: string): string {
    const vault = this.location()
    const directory = join(vault, name)
    const path = relative(vault, directory)
    if (!isProjectName(name) || path !== name || path.includes(sep) || path === '..') {
      throw new Error('This project name cannot be used as a vault folder name.')
    }
    return directory
  }

  private entry(project: Project, account: string): AsyncEntry {
    return new AsyncEntry(this.service, `${project.id}/${account}`)
  }

  private async readKey(project: Project, account: string): Promise<Buffer> {
    const key = await this.findKey(project, account)
    if (!key) throw new Error(`A Keychain key for ${project.name} is missing. .sct cannot read this secret.`)
    return key
  }

  private async findKey(project: Project, account: string): Promise<Buffer | null> {
    try {
      const key = await this.entry(project, account).getSecret()
      return key ? Buffer.from(key) : null
    } catch (error) {
      throw new Error('Cannot read macOS Keychain. Unlock Keychain and try again.', { cause: error })
    }
  }

  private async readSecrets(project: Project, required = false): Promise<StoredSecret[]> {
    let contents: Buffer
    try {
      contents = await readFile(join(this.projectDirectory(project.name), secretsFileName))
    } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error(`Cannot read the secrets of ${project.name}.`, { cause: error })
    }

    const invalid = `The secrets file of ${project.name} is invalid or belongs to a different project. .sct did not change it.`
    const sealed = decodeFile(magic, contents)
    if (!sealed) throw new Error(invalid)
    const key = await this.readKey(project, 'file')
    let secrets: unknown
    try {
      secrets = JSON.parse(open(key, sealed, fileData(project)).toString('utf8'))
    } catch (error) {
      throw new Error(invalid, { cause: error })
    }
    if (!Array.isArray(secrets) || !secrets.every(isStoredSecret)) throw new Error(invalid)
    return secrets
  }

  private async writeSecrets(project: Project, secrets: StoredSecret[]): Promise<void> {
    await this.writeSecretsFile(project, encodeFile(magic, seal(await this.fileKey(project), Buffer.from(JSON.stringify(secrets)), fileData(project))))
  }

  private async writeSecretsFile(project: Project, contents: Buffer): Promise<void> {
    const directory = this.projectDirectory(project.name)
    const filename = join(directory, secretsFileName)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(`${filename}.tmp`, contents, { mode: 0o600 })
      await rename(`${filename}.tmp`, filename)
    } catch (error) {
      throw new Error(`Cannot save the secrets of ${project.name}. Check your local storage permissions.`, { cause: error })
    }
  }

  private async fileKey(project: Project): Promise<Buffer> {
    const existing = await this.findKey(project, 'file')
    if (existing) return existing
    const key = randomBytes(32)
    await this.entry(project, 'file').setSecret(key)
    return key
  }
}

// Additional authenticated data binds each ciphertext to its project and secret, so a copied file or entry fails to open.
function fileData(project: Project): Buffer {
  return Buffer.from(`${project.id}/file`)
}

function valueData(project: Project, id: string): Buffer {
  return Buffer.from(`${project.id}/${id}`)
}

function encodeSealed({ iv, tag, ciphertext }: Sealed): Pick<StoredSecret, 'iv' | 'tag' | 'value'> {
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), value: ciphertext.toString('base64') }
}

function isStoredSecret(value: unknown): value is StoredSecret {
  if (typeof value !== 'object' || value === null) return false
  const secret = value as Record<string, unknown>
  return ['id', 'name', 'iv', 'tag', 'value'].every((field) => typeof secret[field] === 'string')
}

function requireSecretIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000 ||
    !input.every((id): id is string => typeof id === 'string' && id.length > 0) || new Set(input).size !== input.length) {
    throw new Error('Select between 1 and 1000 different secrets from one project.')
  }
  return input
}

// Secret names follow environment variable rules, because approved processes receive secrets as environment variables.
function isSecretName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name)
}

function isSecretValue(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 65536 && !value.includes('\0')
}

function requireSecretInput(input: unknown): { projectId: string; name: string; value: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Enter a secret name and value.')
  const { projectId, name, value } = input as Record<string, unknown>
  if (typeof projectId !== 'string') throw new Error('Select a project.')
  if (!isSecretName(name)) {
    throw new Error('Enter a name of 1 to 100 letters, digits, or underscores. Do not start it with a digit.')
  }
  if (!isSecretValue(value)) throw new Error('Enter at most 65,536 characters without a null character. Empty values are allowed.')
  return { projectId, name, value }
}

function requireSecretUpdate(input: unknown): { projectId: string; id: string; value: string } {
  const { projectId, id } = requireSecretReference(input)
  const { value } = input as Record<string, unknown>
  if (!isSecretValue(value)) throw new Error('Enter at most 65,536 characters without a null character. Empty values are allowed.')
  return { projectId, id, value }
}

function requireSecretReference(input: unknown): { projectId: string; id: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Select a secret.')
  const { projectId, id } = input as Record<string, unknown>
  if (typeof projectId !== 'string' || typeof id !== 'string') throw new Error('Select a secret.')
  return { projectId, id }
}

function requireSecret(secrets: StoredSecret[], id: string): StoredSecret {
  const secret = secrets.find((saved) => saved.id === id)
  if (!secret) throw new Error('This secret does not exist. Refresh the list and try again.')
  return secret
}

async function requireDirectory(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Select an existing folder.')
  try {
    const directory = await realpath(path)
    if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory.')
    return directory
  } catch (error) {
    throw new Error('Select an existing folder that .sct can access.', { cause: error })
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

// rename cannot cross volumes, so a move to another disk copies the vault and then removes the original.
async function moveDirectory(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw new Error('Cannot move the vault folder. Check the folder permissions.', { cause: error })
    }
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    await rm(from, { recursive: true, force: true })
  }
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  await writeFile(`${filename}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(`${filename}.tmp`, filename)
}
