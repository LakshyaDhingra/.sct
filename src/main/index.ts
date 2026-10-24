import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { ProjectStore } from './projects'
import type { Reply } from '../shared/projects'

let mainWindow: BrowserWindow | null = null

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

async function createWindow(): Promise<void> {
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
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { mainWindow = null })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function reportStartupError(error: unknown): void {
  console.error('.sct could not start.', error)
  dialog.showErrorBox('.sct could not start', 'The application window could not load. Check the development terminal for details.')
  app.quit()
}

app.setName('.sct')
nativeTheme.themeSource = 'dark'
app.whenReady().then(async () => {
  const projects = new ProjectStore(join(app.getPath('userData'), 'projects.json'))
  handle('projects:list', () => projects.list())
  handle('projects:add', (input) => projects.add(input))
  handle('projects:pick-directory', async () => {
    if (!mainWindow) throw new Error('The .sct window is unavailable.')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add a project',
      buttonLabel: 'Select folder',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError)
  })
}).catch(reportStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
