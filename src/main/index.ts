import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

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

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL for the dev server; load the
  // built file in production.
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

  registerIpcHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Minimal IPC surface for Phase 0. Later phases add quotes/bars/orders/etc.,
 * all routed through here so the renderer never touches the broker directly.
 */
function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // The live-trading hard gate (see PLAN.md §4). Phase 0 always reports paper;
  // real money requires mode=live AND ALLOW_LIVE_TRADING=1 AND on-screen confirm.
  ipcMain.handle('app:getTradingMode', () => {
    const liveAllowed = process.env['ALLOW_LIVE_TRADING'] === '1'
    return { mode: 'paper' as const, liveAllowed }
  })
}
