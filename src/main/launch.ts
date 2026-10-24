import { spawn } from 'node:child_process'
import type { ChildProcess, StdioOptions } from 'node:child_process'
import { constants } from 'node:os'
import type { ProjectStore } from './projects'
import type { Vault } from './vault'

export function launchProject(vault: Vault, projectId: string, executable: string, args: string[], stdio: StdioOptions = 'inherit'): Promise<ChildProcess> {
  return vault.withProjectEnvironment(projectId, (project, environment) => new Promise<ChildProcess>((resolve, reject) => {
    try {
      const child = spawn(executable, args, { cwd: project.directory, env: environment, stdio, shell: false })
      child.once('error', () => reject(new Error('Cannot start the command. Check the executable and project folder.')))
      child.once('spawn', () => resolve(child))
    } catch {
      reject(new Error('Cannot start the command. Check the executable and project folder.'))
    }
  }))
}

export async function runProject(projects: ProjectStore, vault: Vault, args: string[]): Promise<number> {
  const { projectName, executable, commandArgs } = requireRunArguments(args)
  const project = (await projects.list()).find((saved) => saved.name === projectName)
  if (!project) throw new Error('This project is not in your project list. Use its exact registered name.')
  const child = await launchProject(vault, project.id, executable, commandArgs)
  const forward = (signal: NodeJS.Signals) => { child.kill(signal) }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  process.on('SIGHUP', forward)
  try {
    return await new Promise<number>((resolve) => {
      child.once('close', (code, signal) => resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)))
    })
  } finally {
    process.off('SIGINT', forward)
    process.off('SIGTERM', forward)
    process.off('SIGHUP', forward)
  }
}

function requireRunArguments(args: string[]) {
  if (args[0] !== 'run' || !args[1] || args[2] !== '--' || !args[3]) {
    throw new Error('Usage: sct run "Project name" -- <executable> [arguments]')
  }
  return { projectName: args[1], executable: args[3], commandArgs: args.slice(4) }
}
