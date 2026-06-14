import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import type { PanelKind } from '@shared/types'
import { loadRenderer } from './appProtocol'

const preload = (): string => join(__dirname, '../preload/index.js')

/** One reusable window per (panel, symbol) so re-popping focuses the existing one. */
const panelWindows = new Map<string, BrowserWindow>()

const SIZES: Record<PanelKind, { width: number; height: number }> = {
  ticket: { width: 360, height: 470 },
  chart: { width: 900, height: 620 },
  watchlist: { width: 320, height: 560 },
  positions: { width: 520, height: 420 },
  orders: { width: 560, height: 420 }
}

function title(panel: PanelKind, params: Record<string, string>): string {
  const label = panel.charAt(0).toUpperCase() + panel.slice(1)
  return params.symbol ? `${label} · ${params.symbol}` : label
}

/** Open (or focus) a detached window rendering a single panel. */
export function openPanelWindow(panel: PanelKind, params: Record<string, string> = {}): void {
  const key = `${panel}:${params.symbol ?? ''}`
  const existing = panelWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const size = SIZES[panel] ?? { width: 480, height: 460 }
  const win = new BrowserWindow({
    ...size,
    minWidth: 280,
    minHeight: 240,
    show: false,
    backgroundColor: '#0b0e11',
    title: title(panel, params),
    webPreferences: {
      preload: preload(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => panelWindows.delete(key))
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win, { panel, ...params })
  panelWindows.set(key, win)
}
