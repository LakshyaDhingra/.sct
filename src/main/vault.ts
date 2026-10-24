import { AsyncEntry } from '@napi-rs/keyring'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isProjectName } from './projects.ts'
import type { ProjectStore } from './projects.ts'
import type { Project } from '../shared/projects.ts'
import type { SecretMetadata } from '../shared/secrets.ts'

// secrets.sct layout: magic | IV | GCM tag | ciphertext. The ciphertext holds names and individually encrypted values.
const magic = Buffer.from('SCT1')
const ivLength = 12
const tagLength = 16
const vaultDirectoryName = '.sct'
const secretsFileName = 'secrets.sct'

interface StoredSecret {
  id: string
  name: string
  iv: string
  tag: string
  value: string
}

interface Sealed {
  iv: Buffer
  tag: Buffer
  ciphertext: Buffer
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
      await rm(this.projectDirectory(project.name), { recursive: true, force: true })
      await Promise.all([...secrets.map((secret) => secret.id), 'file'].map((account) => this.entry(project, account).deleteCredential()))
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

  // The file changes first. A failed Keychain deletion leaves an unused key but never a secret without its key.
  deleteSecret(input: unknown): Promise<void> {
    return this.serialize(async () => {
      const { projectId, id } = requireSecretReference(input)
      const project = await this.projects.find(projectId)
      const secrets = await this.readSecrets(project)
      const secret = requireSecret(secrets, id)
      await this.writeSecrets(project, secrets.filter((saved) => saved.id !== secret.id))
      await this.entry(project, secret.id).deleteCredential()
    })
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

  private async readSecrets(project: Project): Promise<StoredSecret[]> {
    let contents: Buffer
    try {
      contents = await readFile(join(this.projectDirectory(project.name), secretsFileName))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error(`Cannot read the secrets of ${project.name}.`, { cause: error })
    }

    const invalid = `The secrets file of ${project.name} is invalid or belongs to a different project. .sct did not change it.`
    if (contents.length < magic.length + ivLength + tagLength || !contents.subarray(0, magic.length).equals(magic)) {
      throw new Error(invalid)
    }
    const key = await this.readKey(project, 'file')
    let secrets: unknown
    try {
      secrets = JSON.parse(open(key, decodeFile(contents), fileData(project)).toString('utf8'))
    } catch (error) {
      throw new Error(invalid, { cause: error })
    }
    if (!Array.isArray(secrets) || !secrets.every(isStoredSecret)) throw new Error(invalid)
    return secrets
  }

  private async writeSecrets(project: Project, secrets: StoredSecret[]): Promise<void> {
    const directory = this.projectDirectory(project.name)
    const filename = join(directory, secretsFileName)
    const { iv, tag, ciphertext } = seal(await this.fileKey(project), Buffer.from(JSON.stringify(secrets)), fileData(project))
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(`${filename}.tmp`, Buffer.concat([magic, iv, tag, ciphertext]), { mode: 0o600 })
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

function seal(key: Buffer, plaintext: Buffer, data: Buffer): Sealed {
  const iv = randomBytes(ivLength)
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(data)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv, tag: cipher.getAuthTag(), ciphertext }
}

function open(key: Buffer, { iv, tag, ciphertext }: Sealed, data: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv).setAAD(data).setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function decodeFile(contents: Buffer): Sealed {
  const ivStart = magic.length
  const tagStart = ivStart + ivLength
  const dataStart = tagStart + tagLength
  return { iv: contents.subarray(ivStart, tagStart), tag: contents.subarray(tagStart, dataStart), ciphertext: contents.subarray(dataStart) }
}

function encodeSealed({ iv, tag, ciphertext }: Sealed): Pick<StoredSecret, 'iv' | 'tag' | 'value'> {
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), value: ciphertext.toString('base64') }
}

function isStoredSecret(value: unknown): value is StoredSecret {
  if (typeof value !== 'object' || value === null) return false
  const secret = value as Record<string, unknown>
  return ['id', 'name', 'iv', 'tag', 'value'].every((field) => typeof secret[field] === 'string')
}

// Secret names follow environment variable rules, because approved processes receive secrets as environment variables.
function isSecretName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name)
}

function isSecretValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 65536
}

function requireSecretInput(input: unknown): { projectId: string; name: string; value: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Enter a secret name and value.')
  const { projectId, name, value } = input as Record<string, unknown>
  if (typeof projectId !== 'string') throw new Error('Select a project.')
  if (!isSecretName(name)) {
    throw new Error('Enter a name of 1 to 100 letters, digits, or underscores. Do not start it with a digit.')
  }
  if (!isSecretValue(value)) throw new Error('Enter a value of 1 to 65,536 characters.')
  return { projectId, name, value }
}

function requireSecretUpdate(input: unknown): { projectId: string; id: string; value: string } {
  const { projectId, id } = requireSecretReference(input)
  const { value } = input as Record<string, unknown>
  if (!isSecretValue(value)) throw new Error('Enter a value of 1 to 65,536 characters.')
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
