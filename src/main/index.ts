import { app, shell, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import type { ProviderKind } from '@shared/types'
import { loadConfig } from './config'
import { createProviders } from './providers'
import { ProviderManager, type BuildProviders } from './providerManager'
import { registerIpc } from './ipc'
import { loadSettings } from './settings'
import { loadCreds } from './secrets/keychain'
import { loadWatchlist } from './persistence'
import { createJournal } from './journal'
import { SafetyGate } from './risk/safetyGate'
import { loadRenderer, registerAppScheme, setupRendererProtocol } from './appProtocol'
import { liveState } from './liveState'

/** System-wide panic key: flatten everything even when the app isn't focused. */
const PANIC_ACCELERATOR = 'CommandOrControl+Shift+Backspace'

const config = loadConfig()
let manager: ProviderManager | null = null

// Env gates for live trading (the third gate is an on-screen typed confirm).
liveState.capable = config.mode === 'live' && config.liveAllowed

// Must run before app `ready`.
registerAppScheme()

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

  loadRenderer(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.daytrader.terminal')
  setupRendererProtocol()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Build providers (creds loaded from the OS keychain). Sim unless the user
  // saved Alpaca keys and selected Alpaca.
  // Live endpoints + live credentials are used ONLY when armed (after the typed
  // confirmation); otherwise paper.
  const build: BuildProviders = (kind, onStatus) =>
    createProviders({
      kind,
      creds: loadCreds(liveState.armed ? 'live' : 'paper'),
      live: liveState.armed,
      onStatus
    })

  const persisted = loadSettings()
  const initialKind: ProviderKind =
    persisted.provider === 'alpaca' && loadCreds('paper') ? 'alpaca' : 'sim'
  const mgr = new ProviderManager(initialKind, build)
  manager = mgr

  // The single submission chokepoint. Fed live context via the manager tap; it
  // re-points across Sim↔Alpaca swaps automatically.
  const journal = createJournal()
  const gate = new SafetyGate({
    getBroker: () => mgr.broker,
    journal,
    onState: (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('stream:risk', state)
      }
    }
  })
  mgr.setContextTap({
    onAccount: (a) => gate.setAccount(a),
    onPositions: (p) => gate.setPositions(p),
    onQuote: (q) => gate.setQuote(q)
  })

  registerIpc(mgr, config, gate, journal)
  mgr.subscribe(loadWatchlist())

  // Global panic-flatten (works even when another app is focused).
  globalShortcut.register(PANIC_ACCELERATOR, () => {
    void gate.flattenAll()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  manager?.stop()
})
