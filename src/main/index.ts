import { app, BrowserWindow, dialog, ipcMain, nativeTheme, ShareMenu } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { ProjectStore } from './projects'
import { Vault } from './vault'
import { runProject } from './launch'
import { runAgent, writeCliOutput } from './agent'
import { AgentAccess } from './agent-access'
import { streamEnvironment } from './runtime'
import { Sharing } from './sharing'
import type { Relay } from './relay-connection'
import type { Reply } from '../shared/api'

let mainWindow: BrowserWindow | null = null
const launchArguments = process.argv.slice(process.defaultApp ? 2 : 1)
const incomingFiles: string[] = []
let sharing: Sharing | undefined
let openingFiles = false

// macOS can deliver a document before the app and its renderer are ready.
app.on('open-file', (event, path) => {
  event.preventDefault()
  incomingFiles.push(path)
  if (sharing && !mainWindow) void createWindow().catch(reportStartupError)
  else void openIncomingFiles()
})

function handle(channel: string, operation: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Reply<unknown>> => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, error: '.sct rejected this request.' }
    }
    try {
      return { ok: true, value: await operation(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The operation failed.' }
    }
  })
}

async function createWindow(hash = incomingFiles.length ? '/sharing' : undefined): Promise<void> {
  const window = new BrowserWindow({
    title: '.sct',
    width: 1000,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    backgroundColor: '#040805',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow = window
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.on('did-finish-load', () => { void openIncomingFiles() })
  window.on('closed', () => { mainWindow = null })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)

  let closing = false
  window.once('close', () => { closing = true })
  try {
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`)
    } else {
      await window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
  } catch (error) {
    // Closing a window during its first load cancels loading without a startup failure.
    if (!closing) throw error
  }
}

async function pickDirectory(options: OpenDialogOptions): Promise<string | null> {
  if (!mainWindow) throw new Error('The .sct window is unavailable.')
  const result = await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

function reportStartupError(error: unknown): void {
  console.error('.sct could not start.', error)
  dialog.showErrorBox('.sct could not start', error instanceof Error ? error.message : 'The application window could not load. Check the development terminal for details.')
  app.quit()
}

app.setName('.sct')
nativeTheme.themeSource = 'dark'
app.whenReady().then(async () => {
  if (launchArguments[0] === 'agent' || launchArguments[0] === 'mcp') {
    app.dock?.hide()
    app.exit(await runAgentSession())
    return
  }
  if (launchArguments[0] === 'skills') {
    if (launchArguments.length !== 1) throw new Error('Usage: sct skills. Return the bundled skill directory and names.')
    await writeCliOutput(JSON.stringify({ directory: skillsDirectory(), skills: (await readdir(skillsDirectory())).filter((name) => name.startsWith('sct-')) }))
    app.exit(0)
    return
  }
  const projects = new ProjectStore(join(app.getPath('userData'), 'projects.json'))
  const vault = new Vault(projects, join(app.getPath('userData'), 'settings.json'), homedir())
  await vault.start()
  if (launchArguments[0] === 'run' || launchArguments[0] === '_env') {
    app.dock?.hide()
    if (launchArguments[0] === '_env') {
      await streamEnvironment(projects, vault, launchArguments[1])
      app.exit(0)
    } else {
      app.exit(await runProject(projects, vault, launchArguments))
    }
    return
  }
  sharing = new Sharing(join(app.getPath('userData'), 'sharing'), vault, hostname().slice(0, 100))
  await sharing.cleanOutbox()
  const { Relay, relayServer } = await import('./relay-connection')
  const relay = new Relay(relayServer(), join(app.getPath('userData'), 'relay', 'cache.sct'), sharing.deviceCard.bind(sharing),
    () => mainWindow?.webContents.send('relay:changed'))
  await relay.start()
  app.on('will-quit', () => relay.stop())
  handle('relay:state', () => relay.state())
  handle('projects:list', () => projects.list())
  handle('projects:add', (input) => vault.addProject(input))
  handle('projects:rename', (input) => vault.renameProject(input))
  handle('projects:delete', (id) => vault.deleteProject(id))
  handle('projects:pick-directory', () => pickDirectory({
    title: 'Add a project',
    buttonLabel: 'Select folder',
    properties: ['openDirectory']
  }))
  handle('secrets:list', () => vault.listSecrets())
  handle('secrets:add', (input) => vault.addSecret(input))
  handle('secrets:update', (input) => vault.updateSecret(input))
  handle('secrets:delete', (input) => vault.deleteSecret(input))
  handle('vault:location', () => vault.location())
  handle('vault:choose-location', async () => {
    const root = await pickDirectory({
      title: 'Choose a storage location',
      buttonLabel: 'Move vault here',
      properties: ['openDirectory', 'createDirectory']
    })
    return root ? vault.moveTo(root) : null
  })
  registerSharing(sharing)
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError)
  })
}).catch((error: unknown) => {
  if (['run', '_env', 'agent', 'mcp', 'skills'].includes(launchArguments[0])) {
    console.error(error instanceof Error ? error.message : 'The project command could not start.')
    app.exit(1)
  } else {
    reportStartupError(error)
  }
})

async function runAgentSession(): Promise<number> {
  let access: AgentAccess | undefined
  let loading: Promise<AgentAccess> | undefined
  let sessionSharing: Sharing | undefined
  let sharingReady: Promise<void> | undefined
  let relay: Promise<Relay> | undefined
  const getSharing = async () => {
    await getAccess()
    if (!sessionSharing) throw new Error('The local sharing service is unavailable.')
    await (sharingReady ??= sessionSharing.cleanOutbox())
    return sessionSharing
  }
  const getAccess = async (): Promise<AgentAccess> => {
    loading ??= (async () => {
      const projects = new ProjectStore(join(app.getPath('userData'), 'projects.json'))
      const vault = new Vault(projects, join(app.getPath('userData'), 'settings.json'), homedir())
      await vault.start()
      sessionSharing = new Sharing(join(app.getPath('userData'), 'sharing'), vault, hostname().slice(0, 100))
      access = new AgentAccess(projects, vault, {
        review: async () => {
          if (!mainWindow) await createWindow('/agent')
          mainWindow?.show()
          mainWindow?.focus()
        },
        changed: () => mainWindow?.webContents.send('agent:changed'),
        sharing: getSharing,
        shareFile: shareAgentFile,
        relayState: async () => {
          relay ??= (async () => {
            const { Relay, relayServer } = await import('./relay-connection')
            const service = new Relay(relayServer(), join(app.getPath('userData'), 'relay', 'cache.sct'),
              async () => (await getSharing()).deviceCard(), () => undefined)
            await service.start()
            return service
          })()
          return (await relay).state()
        },
        executable: process.execPath,
        demo: app.isPackaged ? join(process.resourcesPath, 'demo', 'index.cjs') : join(__dirname, '../demo/index.cjs')
      })
      return access
    })().catch((error: unknown) => { loading = undefined; throw error })
    return loading
  }
  handle('agent:requests', () => access?.views() ?? [])
  handle('agent:respond', async (input) => {
    if (!access) throw new Error('No agent request is awaiting approval.')
    await access.respond(input)
  })
  app.on('window-all-closed', () => access?.cancelAll())
  try {
    const submit = async (input: unknown, signal?: AbortSignal) => (await getAccess()).submit(input, signal)
    if (launchArguments[0] === 'agent') return await runAgent(launchArguments, submit)
    await (await import('./mcp')).runMcp(launchArguments, submit, skillsDirectory())
    return 0
  } finally {
    access?.disconnect()
    if (relay) (await relay.catch(() => undefined))?.stop()
    mainWindow?.destroy()
  }
}

function skillsDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills') : join(__dirname, '../../skills')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerSharing(service: Sharing): void {
  handle('sharing:state', () => service.state())
  handle('sharing:device-card', async () => showShareMenu(await service.deviceCardFile()))
  handle('sharing:pick-peer', async () => {
    const path = await pickDirectory({ title: 'Verify a recipient device', properties: ['openFile'],
      filters: [{ name: '.sct device card', extensions: ['sct-device'] }] })
    return path ? service.previewPeer(path) : null
  })
  handle('sharing:confirm-peer', async (token) => {
    const peer = await service.confirmPeer(token)
    sharingChanged()
    return peer
  })
  handle('sharing:send', async (input) => showShareMenu(await service.exportSecrets(input)))
  handle('sharing:pick-transfer', async () => {
    const path = await pickDirectory({ title: 'Open an encrypted .sct transfer', properties: ['openFile'],
      filters: [{ name: '.sct transfer', extensions: ['sct-transfer'] }] })
    if (!path) return null
    const preview = await service.openTransfer(path)
    sharingChanged()
    return preview
  })
  handle('sharing:import', async (input) => {
    const metadata = await service.importTransfer(input)
    sharingChanged()
    return metadata
  })
  handle('sharing:dismiss', async (id) => {
    await service.dismissTransfer(id)
    sharingChanged()
  })
  app.on('will-quit', () => {
    rmSync(join(app.getPath('userData'), 'sharing', 'outbox'), { recursive: true, force: true })
  })
}

function showShareMenu(path: string): void {
  if (!mainWindow) throw new Error('The .sct window is unavailable.')
  if (process.platform !== 'darwin') throw new Error('AirDrop sharing requires macOS.')
  // A closed share menu does not confirm transport completion or recipient import.
  new ShareMenu({ filePaths: [path] }).popup({ window: mainWindow })
}

function shareAgentFile(path: string): Promise<void> {
  const window = mainWindow
  if (!window) throw new Error('The .sct approval window is unavailable.')
  if (process.platform !== 'darwin') throw new Error('AirDrop sharing requires macOS.')
  return new Promise((resolve) => {
    // A CLI session must keep the native menu alive until the user finishes choosing a transport.
    new ShareMenu({ filePaths: [path] }).popup({ window, callback: resolve })
  })
}

function sharingChanged(): void {
  mainWindow?.webContents.send('sharing:changed')
}

async function openIncomingFiles(): Promise<void> {
  if (openingFiles || !sharing || !mainWindow || mainWindow.webContents.isLoading()) return
  const path = incomingFiles.shift()
  if (!path) return
  openingFiles = true
  try {
    await sharing.openTransfer(path)
    mainWindow?.show()
    sharingChanged()
  } catch (error) {
    dialog.showErrorBox('Cannot open this .sct transfer', error instanceof Error ? error.message : 'The transfer could not be opened.')
  } finally {
    openingFiles = false
    if (incomingFiles.length) void openIncomingFiles()
  }
}
