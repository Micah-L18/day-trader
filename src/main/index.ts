import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { DEFAULT_WATCHLIST, type ProviderKind } from '@shared/types'
import { loadConfig } from './config'
import { createProviders } from './providers'
import { ProviderManager, type BuildProviders } from './providerManager'
import { registerIpc } from './ipc'
import { loadSettings } from './settings'
import { loadCreds } from './secrets/keychain'

const config = loadConfig()
let manager: ProviderManager | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e11',
    autoHideMenuBar: true,
    title: 'Daytrader Terminal',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.daytrader.terminal')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Build providers (creds loaded from the OS keychain). Sim unless the user
  // saved Alpaca keys and selected Alpaca.
  const build: BuildProviders = (kind, onStatus) =>
    createProviders({ kind, creds: loadCreds(), live: config.mode === 'live', onStatus })

  const persisted = loadSettings()
  const initialKind: ProviderKind =
    persisted.provider === 'alpaca' && loadCreds() ? 'alpaca' : 'sim'
  manager = new ProviderManager(initialKind, build)

  registerIpc(manager, config)
  manager.subscribe([...DEFAULT_WATCHLIST])

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  manager?.stop()
})
