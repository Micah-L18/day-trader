import { app, BrowserWindow, ipcMain } from 'electron'
import {
  LIVE_CONFIRM_PHRASE,
  type AlpacaCredentials,
  type ArmLiveInput,
  type ArmLiveResult,
  type Keymap,
  type LayoutsState,
  type LiveState,
  type OrderRequest,
  type PanelKind,
  type PortfoliosState,
  type RiskLimits,
  type SaveSettingsInput,
  type Timeframe,
  type WatchlistsState
} from '@shared/types'
import type { AppConfig } from '../config'
import type { ProviderManager } from '../providerManager'
import type { SafetyGate } from '../risk/safetyGate'
import type { Journal } from '../journal'
import { loadCreds, saveCreds } from '../secrets/keychain'
import { saveSettings } from '../settings'
import { getSettingsInfo, testConnection } from '../settingsService'
import { openPanelWindow } from '../windows'
import { liveState } from '../liveState'
import { activePortfolio } from '../portfolioState'
import { evaluateArm } from '../risk/liveGate'
import {
  allWatchlistSymbols,
  isOnboarded,
  loadKeymap,
  loadLayouts,
  loadDrawings,
  loadPortfolios,
  loadWatchlists,
  saveDrawings,
  saveKeymap,
  saveLayouts,
  savePortfolios,
  saveRiskLimits,
  saveWatchlists,
  setOnboarded
} from '../persistence'

/**
 * Register all request/response IPC handlers. Every renderer capability is
 * backed here, routed through the ProviderManager (so a provider swap is
 * transparent). Order submission is intentionally NOT exposed yet — it arrives
 * in Phase 4 behind the SafetyGate.
 */
export function registerIpc(
  manager: ProviderManager,
  config: AppConfig,
  gate: SafetyGate,
  journal: Journal
): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getTradingMode', () => ({
    mode: liveState.armed ? 'live' : 'paper',
    liveAllowed: config.liveAllowed,
    provider: manager.marketData.name
  }))

  ipcMain.handle('data:getBars', (_e, symbol: string, timeframe: Timeframe, limit: number) =>
    manager.marketData.getBars(symbol, timeframe, limit)
  )
  ipcMain.handle('data:snapshots', (_e, symbols: string[]) =>
    manager.marketData.getSnapshots(symbols)
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
  ipcMain.handle('risk:setLimits', (_e, limits: Partial<RiskLimits>) => {
    gate.setLimits(limits)
    saveRiskLimits(gate.getState().limits)
    return gate.getState()
  })

  // ---- Detached panel windows ----
  ipcMain.handle('windows:open', (_e, panel: PanelKind, params?: Record<string, string>) => {
    openPanelWindow(panel, params ?? {})
  })

  // Watchlists (multiple named lists, persisted to JSON in userData).
  ipcMain.handle('watchlists:get', () => loadWatchlists())
  ipcMain.handle('watchlists:set', (_e, state: WatchlistsState) => {
    saveWatchlists(state)
    manager.subscribe(allWatchlistSymbols(state))
    return state
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

  // Chart drawings (horizontal lines, keyed by symbol).
  ipcMain.handle('drawings:get', () => loadDrawings())
  ipcMain.handle('drawings:set', (_e, map: Record<string, number[]>) => {
    saveDrawings(map)
    return map
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
    if (input.alpaca) saveCreds('paper', input.alpaca)
    saveSettings({ provider: input.provider })
    return getSettingsInfo()
  })
  ipcMain.handle('settings:testConnection', (_e, creds?: AlpacaCredentials) =>
    testConnection(creds ?? loadCreds('paper'))
  )

  // ---- Live trading (the third gate: an on-screen typed confirmation) ----
  const liveSnapshot = (): LiveState => ({
    capable: liveState.capable,
    armed: liveState.armed,
    hasLiveKeys: loadCreds('live') != null
  })
  const broadcastLive = (): void => {
    const payload = liveSnapshot()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('stream:live', payload)
    }
  }

  ipcMain.handle('live:getState', (): LiveState => liveSnapshot())

  ipcMain.handle('live:arm', (_e, input: ArmLiveInput): ArmLiveResult => {
    // Store provided live keys only once the env + confirm gates have passed.
    if (liveState.capable && input.confirm === LIVE_CONFIRM_PHRASE && input.live?.keyId && input.live?.secretKey) {
      saveCreds('live', input.live)
    }
    const decision = evaluateArm({
      capable: liveState.capable,
      confirm: input.confirm,
      hasLiveKeys: loadCreds('live') != null
    })
    if (!decision.ok) return { ok: false, armed: liveState.armed, message: decision.message }

    liveState.armed = true
    manager.switch('alpaca') // rebuilds with live endpoints + live credentials
    gate.resetDailyBaseline()
    journal.log('live_armed')
    broadcastLive()
    return { ok: true, armed: true, message: decision.message }
  })

  ipcMain.handle('live:disarm', (): LiveState => {
    liveState.armed = false
    manager.switch(activePortfolio.kind)
    gate.resetDailyBaseline()
    journal.log('live_disarmed')
    broadcastLive()
    return liveSnapshot()
  })

  // ---- Portfolios (account switcher) ----
  function applyActive(state: PortfoliosState): void {
    const p = state.portfolios.find((x) => x.id === state.activeId)
    if (!p) return
    activePortfolio.kind = p.kind
    activePortfolio.startingCash = p.startingCash ?? 50_000
  }

  ipcMain.handle('portfolios:get', () => loadPortfolios())
  ipcMain.handle('portfolios:save', (_e, state: PortfoliosState) => {
    savePortfolios(state)
    applyActive(state)
    return state
  })
  ipcMain.handle('portfolios:setActive', (_e, id: string) => {
    const state = loadPortfolios()
    if (!state.portfolios.some((p) => p.id === id)) return state
    state.activeId = id
    savePortfolios(state)
    applyActive(state)
    if (!liveState.armed) manager.switch(activePortfolio.kind)
    gate.resetDailyBaseline()
    return state
  })
}
