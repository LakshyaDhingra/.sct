import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess, StdioOptions } from 'node:child_process'
import { constants } from 'node:os'
import type { ProjectStore } from './projects'
import type { Vault } from './vault'
import { resolveProject, watchProject } from './runtime'

export function launchProject(vault: Vault, projectId: string, executable: string, args: string[], stdio: StdioOptions = 'inherit', detached = false): Promise<ChildProcess> {
  return vault.withProjectEnvironment(projectId, (project, environment) => new Promise<ChildProcess>((resolve, reject) => {
    try {
      const child = spawn(executable, args, { cwd: project.directory, env: environment, stdio, shell: false, detached })
      child.once('error', () => reject(new Error('Cannot start the command. Check the executable and project folder.')))
      child.once('spawn', () => resolve(child))
    } catch {
      reject(new Error('Cannot start the command. Check the executable and project folder.'))
    }
  }))
}

export async function runProject(projects: ProjectStore, vault: Vault, args: string[]): Promise<number> {
  const { projectName, executable, commandArgs } = requireRunArguments(args)
  const project = await resolveProject(projects, projectName)
  let child: ChildProcess | undefined
  let restarting = false
  let closing = false
  let finish: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => { finish = resolve })
  const forward = (signal: NodeJS.Signals) => {
    closing = true
    if (child) signalCommand(child, signal)
    else finish(128 + constants.signals[signal])
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  process.on('SIGHUP', forward)
  let stop: (() => Promise<void>) | undefined
  try {
    stop = await watchProject(vault, project.id, async () => {
      restarting = true
      if (child) await stopCommand(child)
      if (closing) return
      child = await launchProject(vault, project.id, executable, commandArgs, 'inherit', true)
      restarting = false
      const launched = child
      child.once('close', (code, signal) => {
        signalCommand(launched, 'SIGKILL')
        child = undefined
        if (!restarting || closing) finish(code ?? (signal ? 128 + constants.signals[signal] : 1))
      })
    }, async () => {
      restarting = true
      if (child) await stopCommand(child)
      console.error('Cannot refresh .sct secrets. The command is stopped until storage and Keychain are available.')
    })
    return await exited
  } finally {
    closing = true
    await stop?.()
    if (child) await stopCommand(child)
    process.off('SIGINT', forward)
    process.off('SIGTERM', forward)
    process.off('SIGHUP', forward)
  }
}

function requireRunArguments(args: string[]) {
  const separator = args[1] === '--' ? 1 : 2
  if (args[0] !== 'run' || args[separator] !== '--' || !args[separator + 1]) {
    throw new Error('Usage: sct run ["Project name"] -- <executable> [arguments]')
  }
  return { projectName: separator === 1 ? undefined : args[1], executable: args[separator + 1], commandArgs: args.slice(separator + 2) }
}

function signalCommand(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    // macOS returns EPERM for a group with only zombies. Live processes must still produce an error.
    if (process.platform === 'darwin' && (error as NodeJS.ErrnoException).code === 'EPERM' && commandGroupExited(child.pid)) return
    throw error
  }
}

function commandGroupExited(pid: number): boolean {
  const result = spawnSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' })
  if (result.status !== 0) return false
  return result.stdout.split('\n').every((line) => {
    const [group, state] = line.trim().split(/\s+/)
    return group !== String(pid) || state?.startsWith('Z') === true
  })
}

async function stopCommand(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    signalCommand(child, 'SIGKILL')
    return
  }
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  signalCommand(child, 'SIGTERM')
  const force = setTimeout(() => signalCommand(child, 'SIGKILL'), 2000)
  try {
    await exited
  } finally {
    clearTimeout(force)
    signalCommand(child, 'SIGKILL')
  }
}
