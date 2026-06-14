import { app, BrowserWindow, ipcMain } from 'electron'
import { DEFAULT_WATCHLIST, type Timeframe } from '@shared/types'
import type { AppConfig } from '../config'
import type { Providers } from '../providers/types'

/**
 * Register all request/response IPC handlers. Every renderer capability is
 * backed here — the renderer has no direct access to providers or the broker.
 */
export function registerIpc(providers: Providers, config: AppConfig): void {
  const { marketData, broker } = providers

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getTradingMode', () => ({
    mode: config.mode,
    liveAllowed: config.liveAllowed,
    provider: marketData.name
  }))

  ipcMain.handle('data:getBars', (_e, symbol: string, timeframe: Timeframe, limit: number) =>
    marketData.getBars(symbol, timeframe, limit)
  )
  ipcMain.handle('data:subscribe', (_e, symbols: string[]) => {
    marketData.subscribe(symbols)
  })
  ipcMain.handle('data:unsubscribe', (_e, symbols: string[]) => {
    marketData.unsubscribe(symbols)
  })

  ipcMain.handle('account:get', () => broker.getAccount())
  ipcMain.handle('positions:get', () => broker.getPositions())
  ipcMain.handle('orders:get', () => broker.getOrders())

  // In-memory watchlist for Phase 1; persisted to SQLite in Phase 5.
  let watchlist: string[] = [...DEFAULT_WATCHLIST]
  ipcMain.handle('watchlist:get', () => watchlist)
  ipcMain.handle('watchlist:set', (_e, list: string[]) => {
    watchlist = list.map((s) => s.toUpperCase())
    marketData.subscribe(watchlist)
    return watchlist
  })
}

/**
 * Forward provider stream events to every renderer window. Channels mirror the
 * `window.api.*.on*` subscriptions in the preload bridge.
 */
export function wireStreams(providers: Providers): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  providers.marketData.on('quote', (q) => broadcast('stream:quote', q))
  providers.marketData.on('bar', (b) => broadcast('stream:bar', b))
  providers.marketData.on('trade', (t) => broadcast('stream:trade', t))
  providers.broker.on('order', (o) => broadcast('stream:order', o))
  providers.broker.on('positions', (p) => broadcast('stream:positions', p))
  providers.broker.on('account', (a) => broadcast('stream:account', a))
}
