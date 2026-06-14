import { app, ipcMain } from 'electron'
import {
  type AlpacaCredentials,
  type Keymap,
  type LayoutsState,
  type OrderRequest,
  type PanelKind,
  type SaveSettingsInput,
  type Timeframe
} from '@shared/types'
import type { AppConfig } from '../config'
import type { ProviderManager } from '../providerManager'
import type { SafetyGate } from '../risk/safetyGate'
import { loadCreds, saveCreds } from '../secrets/keychain'
import { saveSettings } from '../settings'
import { getSettingsInfo, testConnection } from '../settingsService'
import { openPanelWindow } from '../windows'
import {
  isOnboarded,
  loadKeymap,
  loadLayouts,
  loadWatchlist,
  saveKeymap,
  saveLayouts,
  saveWatchlist,
  setOnboarded
} from '../persistence'

/**
 * Register all request/response IPC handlers. Every renderer capability is
 * backed here, routed through the ProviderManager (so a provider swap is
 * transparent). Order submission is intentionally NOT exposed yet — it arrives
 * in Phase 4 behind the SafetyGate.
 */
export function registerIpc(manager: ProviderManager, config: AppConfig, gate: SafetyGate): void {
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

  // ---- Orders + risk (every submission goes through the SafetyGate) ----
  ipcMain.handle('orders:submit', (_e, req: OrderRequest) => gate.submitOrder(req))
  ipcMain.handle('orders:cancel', (_e, orderId: string) => gate.cancelOrder(orderId))
  ipcMain.handle('risk:getState', () => gate.getState())
  ipcMain.handle('risk:setKillSwitch', (_e, on: boolean) => {
    gate.setKillSwitch(on)
    return gate.getState()
  })
  ipcMain.handle('risk:flattenAll', () => gate.flattenAll())

  // ---- Detached panel windows ----
  ipcMain.handle('windows:open', (_e, panel: PanelKind, params?: Record<string, string>) => {
    openPanelWindow(panel, params ?? {})
  })

  // Watchlist (persisted to JSON in userData).
  ipcMain.handle('watchlist:get', () => loadWatchlist())
  ipcMain.handle('watchlist:set', (_e, list: string[]) => {
    const normalized = list.map((s) => s.toUpperCase())
    saveWatchlist(normalized)
    manager.subscribe(normalized)
    return normalized
  })

  // Hotkeys (persisted to JSON in userData).
  ipcMain.handle('hotkeys:get', () => loadKeymap())
  ipcMain.handle('hotkeys:save', (_e, keymap: Keymap) => {
    saveKeymap(keymap)
    return keymap
  })

  // Layouts (persisted to JSON in userData).
  ipcMain.handle('layouts:get', () => loadLayouts())
  ipcMain.handle('layouts:save', (_e, state: LayoutsState) => {
    saveLayouts(state)
    return state
  })

  // First-run onboarding flag.
  ipcMain.handle('onboarding:get', () => isOnboarded())
  ipcMain.handle('onboarding:complete', () => {
    setOnboarded()
    return true
  })

  // ---- Settings ----
  ipcMain.handle('settings:get', () => getSettingsInfo())
  ipcMain.handle('settings:save', (_e, input: SaveSettingsInput) => {
    if (input.alpaca) saveCreds(input.alpaca)
    saveSettings({ provider: input.provider })
    manager.switch(input.provider)
    gate.resetDailyBaseline() // new provider re-establishes the equity baseline
    return getSettingsInfo()
  })
  ipcMain.handle('settings:testConnection', (_e, creds?: AlpacaCredentials) =>
    testConnection(creds ?? loadCreds())
  )
}
