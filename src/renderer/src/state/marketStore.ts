import { create } from 'zustand'
import type { Bar, BarUpdate, Quote } from '@shared/types'

const MAX_BARS = 240

interface MarketState {
  quotes: Record<string, Quote>
  /** Session reference price per symbol (first quote seen), for % change. */
  opens: Record<string, number>
  bars: Record<string, Bar[]>
  setQuote: (q: Quote) => void
  setBars: (symbol: string, bars: Bar[]) => void
  applyBar: (b: BarUpdate) => void
}

export const useMarketStore = create<MarketState>((set) => ({
  quotes: {},
  opens: {},
  bars: {},
  setQuote: (q) =>
    set((s) => {
      const last = q.last ?? q.bid
      const opens =
        s.opens[q.symbol] === undefined ? { ...s.opens, [q.symbol]: last } : s.opens
      return { quotes: { ...s.quotes, [q.symbol]: q }, opens }
    }),
  setBars: (symbol, bars) =>
    set((s) => ({ bars: { ...s.bars, [symbol]: bars.slice(-MAX_BARS) } })),
  applyBar: (b) =>
    set((s) => {
      const list = s.bars[b.symbol] ? [...s.bars[b.symbol]] : []
      const bar: Bar = {
        symbol: b.symbol,
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume
      }
      const last = list[list.length - 1]
      if (last && last.time === b.time) list[list.length - 1] = bar
      else list.push(bar)
      return { bars: { ...s.bars, [b.symbol]: list.slice(-MAX_BARS) } }
    })
}))

/** Percent change of a symbol vs. its session reference price. */
export function changePct(quotes: Record<string, Quote>, opens: Record<string, number>, symbol: string): number {
  const q = quotes[symbol]
  const open = opens[symbol]
  if (!q || !open) return 0
  const last = q.last ?? q.bid
  return ((last - open) / open) * 100
}
