import { access, lstat, mkdir, readlink, rename, symlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export async function installCli(executable: string, destination: string): Promise<void> {
  await access(executable, constants.X_OK)
  try {
    if (!(await lstat(destination)).isSymbolicLink()) throw new Error('The sct command already exists and is not a symbolic link.')
    if (resolve(dirname(destination), await readlink(destination)) === executable) return
    throw new Error('The sct command points to another application. Remove that link before installing .sct.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(destination), { recursive: true })
  await symlink(executable, `${destination}.tmp`)
  await rename(`${destination}.tmp`, destination)
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
