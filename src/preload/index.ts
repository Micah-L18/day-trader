import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface TradingModeInfo {
  mode: 'paper' | 'live'
  liveAllowed: boolean
}

/**
 * The typed API surface exposed to the renderer. Every capability the UI needs
 * is added here and backed by an ipcMain handler in the main process — the
 * renderer has no direct access to Node, the filesystem, or the broker.
 *
 * Later phases extend this with quotes/bars/orders/positions/account/hotkeys.
 */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getTradingMode: (): Promise<TradingModeInfo> => ipcRenderer.invoke('app:getTradingMode')
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback for the (non-default) case where context isolation is disabled.
  // @ts-ignore - defined on Window in index.d.ts
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
