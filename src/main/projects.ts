import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Project, ProjectInput } from '../shared/projects.ts'

function isProjectInput(value: unknown): value is ProjectInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.name === 'string' && input.name.trim().length > 0 &&
    input.name.length <= 100 && typeof input.directory === 'string' &&
    input.directory.length <= 4096 && isAbsolute(input.directory)
}

export class ProjectStore {
  private pending: Promise<void> = Promise.resolve()
  private readonly filename: string

  constructor(filename: string) {
    this.filename = filename
  }

  async list(): Promise<Project[]> {
    let contents: string
    try {
      contents = await readFile(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Cannot read the saved project list.', { cause: error })
    }

    let projects: unknown
    try {
      projects = JSON.parse(contents)
    } catch (error) {
      throw new Error('The saved project list is invalid. .sct did not change it.', { cause: error })
    }
    if (!Array.isArray(projects) || !projects.every((project: unknown) =>
      isProjectInput(project) && 'id' in project && typeof project.id === 'string' && project.id.length > 0
    )) {
      throw new Error('The saved project list is invalid. .sct did not change it.')
    }
    return projects as Project[]
  }

  add(input: unknown): Promise<Project> {
    const operation = this.pending.then(() => this.save(input))
    this.pending = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async save(input: unknown): Promise<Project> {
    if (!isProjectInput(input)) {
      throw new Error('Enter a project name and an absolute folder path.')
    }

    let directory: string
    try {
      directory = await realpath(input.directory)
      if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory.')
    } catch (error) {
      throw new Error('Select an existing folder that .sct can access.', { cause: error })
    }

    const projects = await this.list()
    if (projects.some((project) => project.directory === directory)) {
      throw new Error('This folder is already in your project list.')
    }
    const project: Project = { id: randomUUID(), name: input.name.trim(), directory }

    try {
      await mkdir(dirname(this.filename), { recursive: true })
      await writeFile(`${this.filename}.tmp`, JSON.stringify([...projects, project], null, 2), { mode: 0o600 })
      await rename(`${this.filename}.tmp`, this.filename)
    } catch (error) {
      throw new Error('Cannot save the project. Check your local storage permissions.', { cause: error })
    }
    return project
  }
}
