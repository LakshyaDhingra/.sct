import { access, lstat, mkdir, readFile, readlink, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const marker = '# .sct command launcher'

// Electron finds its helper apps only from the real executable path. A symbolic link makes it exit before its window opens.
// `exec` replaces the shell, so the caller stays the parent process of .sct.
export async function installCli(executable: string, destination: string): Promise<void> {
  await access(executable, constants.X_OK)
  const command = `exec '${executable.replaceAll("'", `'\\''`)}' "$@"`
  if (await isInstalled(destination, executable, command)) return
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(`${destination}.tmp`, `#!/bin/sh\n${marker}\n${command}\n`, { mode: 0o755 })
  await rename(`${destination}.tmp`, destination)
}

// Accept a missing command and an earlier .sct link to the same executable. Reject every other existing command.
async function isInstalled(destination: string, executable: string, command: string): Promise<boolean> {
  try {
    if ((await lstat(destination)).isSymbolicLink()) {
      if (resolve(dirname(destination), await readlink(destination)) === executable) return false
      throw new Error('The sct command points to another application. Remove that link before installing .sct.')
    }
    const current = await readFile(destination, 'utf8')
    if (!current.includes(marker)) throw new Error('The sct command already exists and is not an .sct launcher.')
    if (!current.includes(command)) throw new Error('The sct command starts another application. Remove it before installing .sct.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

if (import.meta.main) {
  const destination = join(homedir(), '.local', 'bin', 'sct')
  await installCli(resolve(`dist/sct-darwin-${process.arch}/sct.app/Contents/MacOS/sct`), destination)
  console.log(`Installed ${destination}`)
  if (!(process.env.PATH ?? '').split(':').includes(dirname(destination))) {
    console.log('Add this line to ~/.zshrc, then open a new terminal:')
    console.log('export PATH="$HOME/.local/bin:$PATH"')
  }
}
