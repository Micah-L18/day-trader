import { useEffect } from 'react'
import { useAccountStore } from './accountStore'
import { useMarketStore } from './marketStore'
import { useWatchlistStore } from './watchlistStore'
import { useSystemStore } from './systemStore'
import { useRiskStore } from './riskStore'
import { useLiveStore } from './liveStore'
import { useDrawingStore } from './drawingStore'

/**
 * Connects the preload `window.api` streams to the zustand stores. Mount once,
 * at the app root. Returns nothing — components read the stores directly.
 */
export function useStreamBridge(opts: { loadWatchlist?: boolean } = {}): void {
  const loadWatchlist = opts.loadWatchlist ?? true
  useEffect(() => {
    const market = useMarketStore.getState()
    const account = useAccountStore.getState()
    const system = useSystemStore.getState()
    const risk = useRiskStore.getState()
    const liveStore = useLiveStore.getState()

    // Initial snapshots. Panel windows seed their own symbol, so they skip the
    // watchlist load (which would override the selection).
    if (loadWatchlist) void useWatchlistStore.getState().load()
    void window.api.account.get().then(account.setAccount)
    void window.api.positions.get().then(account.setPositions)
    void window.api.orders.get().then(account.setOrders)
    void window.api.status.get().then(system.setStatus)
    void window.api.risk.getState().then(risk.setRisk)
    void window.api.live.getState().then(liveStore.setLive)
    void useDrawingStore.getState().load()

    // Live subscriptions.
    const unsubs = [
      window.api.data.onQuote(market.setQuote),
      window.api.data.onBar(market.applyBar),
      window.api.account.onUpdate(account.setAccount),
      window.api.positions.onUpdate(account.setPositions),
      window.api.orders.onUpdate(account.upsertOrder),
      window.api.status.onUpdate(system.setStatus),
      window.api.risk.onUpdate(risk.setRisk),
      window.api.live.onUpdate(liveStore.setLive)
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
}
