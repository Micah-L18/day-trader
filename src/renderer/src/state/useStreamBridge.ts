import { useEffect } from 'react'
import { useAccountStore } from './accountStore'
import { useMarketStore } from './marketStore'
import { useWatchlistStore } from './watchlistStore'

/**
 * Connects the preload `window.api` streams to the zustand stores. Mount once,
 * at the app root. Returns nothing — components read the stores directly.
 */
export function useStreamBridge(): void {
  useEffect(() => {
    const market = useMarketStore.getState()
    const account = useAccountStore.getState()
    const watchlist = useWatchlistStore.getState()

    // Initial snapshots.
    void window.api.watchlist.get().then(watchlist.setSymbols)
    void window.api.account.get().then(account.setAccount)
    void window.api.positions.get().then(account.setPositions)
    void window.api.orders.get().then(account.setOrders)

    // Live subscriptions.
    const unsubs = [
      window.api.data.onQuote(market.setQuote),
      window.api.data.onBar(market.applyBar),
      window.api.account.onUpdate(account.setAccount),
      window.api.positions.onUpdate(account.setPositions),
      window.api.orders.onUpdate(account.upsertOrder)
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
}
