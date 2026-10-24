import { contextBridge, ipcRenderer } from 'electron'
import type { Reply, SctAPI } from '../shared/api'
import type { Project, ProjectInput, ProjectRename } from '../shared/projects'
import type { SecretInput, SecretMetadata, SecretReference, SecretUpdate } from '../shared/secrets'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply: Reply<T> = await ipcRenderer.invoke(channel, ...args)
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}

const api: SctAPI = {
  listProjects: () => invoke<Project[]>('projects:list'),
  pickDirectory: () => invoke<string | null>('projects:pick-directory'),
  addProject: (input: ProjectInput) => invoke<Project>('projects:add', input),
  renameProject: (input: ProjectRename) => invoke<Project>('projects:rename', input),
  deleteProject: (id: string) => invoke<void>('projects:delete', id),
  listSecrets: () => invoke<SecretMetadata[]>('secrets:list'),
  addSecret: (input: SecretInput) => invoke<SecretMetadata>('secrets:add', input),
  updateSecret: (input: SecretUpdate) => invoke<SecretMetadata>('secrets:update', input),
  deleteSecret: (input: SecretReference) => invoke<void>('secrets:delete', input),
  getVaultLocation: () => invoke<string>('vault:location'),
  chooseVaultLocation: () => invoke<string | null>('vault:choose-location')
}

contextBridge.exposeInMainWorld('sct', api)
