import { contextBridge, ipcRenderer } from 'electron'
import type { Project, ProjectInput, Reply, SctAPI } from '../shared/projects'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply: Reply<T> = await ipcRenderer.invoke(channel, ...args)
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}

const api: SctAPI = {
  listProjects: () => invoke<Project[]>('projects:list'),
  pickDirectory: () => invoke<string | null>('projects:pick-directory'),
  addProject: (input: ProjectInput) => invoke<Project>('projects:add', input)
}

contextBridge.exposeInMainWorld('sct', api)
