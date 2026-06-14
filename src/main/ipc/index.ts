import { app, ipcMain } from 'electron'
import {
  DEFAULT_WATCHLIST,
  type AlpacaCredentials,
  type SaveSettingsInput,
  type Timeframe
} from '@shared/types'
import type { AppConfig } from '../config'
import type { ProviderManager } from '../providerManager'
import { loadCreds, saveCreds } from './../secrets/keychain'
import { saveSettings } from '../settings'
import { getSettingsInfo, testConnection } from '../settingsService'

/**
 * Register all request/response IPC handlers. Every renderer capability is
 * backed here, routed through the ProviderManager (so a provider swap is
 * transparent). Order submission is intentionally NOT exposed yet — it arrives
 * in Phase 4 behind the SafetyGate.
 */
export function registerIpc(manager: ProviderManager, config: AppConfig): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getTradingMode', () => ({
    mode: config.mode,
    liveAllowed: config.liveAllowed,
    provider: manager.marketData.name
  }))

  ipcMain.handle('data:getBars', (_e, symbol: string, timeframe: Timeframe, limit: number) =>
    manager.marketData.getBars(symbol, timeframe, limit)
  )
  ipcMain.handle('data:subscribe', (_e, symbols: string[]) => {
    manager.subscribe(symbols)
  })
  ipcMain.handle('data:unsubscribe', (_e, symbols: string[]) => {
    manager.marketData.unsubscribe(symbols)
  })

  ipcMain.handle('account:get', () => manager.broker.getAccount())
  ipcMain.handle('positions:get', () => manager.broker.getPositions())
  ipcMain.handle('orders:get', () => manager.broker.getOrders())
  ipcMain.handle('status:get', () => manager.getStatus())

  // In-memory watchlist for Phase 1–3; persisted to SQLite in Phase 5.
  let watchlist: string[] = [...DEFAULT_WATCHLIST]
  ipcMain.handle('watchlist:get', () => watchlist)
  ipcMain.handle('watchlist:set', (_e, list: string[]) => {
    watchlist = list.map((s) => s.toUpperCase())
    manager.subscribe(watchlist)
    return watchlist
  })

  // ---- Settings ----
  ipcMain.handle('settings:get', () => getSettingsInfo())
  ipcMain.handle('settings:save', (_e, input: SaveSettingsInput) => {
    if (input.alpaca) saveCreds(input.alpaca)
    saveSettings({ provider: input.provider })
    manager.switch(input.provider)
    return getSettingsInfo()
  })
  ipcMain.handle('settings:testConnection', (_e, creds?: AlpacaCredentials) =>
    testConnection(creds ?? loadCreds())
  )
}
