export interface Project {
  id: string
  name: string
  directory: string
}

export interface ProjectInput {
  name: string
  directory: string
}

export interface SctAPI {
  listProjects: () => Promise<Project[]>
  pickDirectory: () => Promise<string | null>
  addProject: (input: ProjectInput) => Promise<Project>
}

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
