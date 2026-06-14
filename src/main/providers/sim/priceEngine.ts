import { TIMEFRAME_MS, type Bar, type Timeframe } from '@shared/types'

/** Plausible starting prices; unknown symbols get a stable hash-derived price. */
const SEED_PRICES: Record<string, number> = {
  AAPL: 224.5,
  NVDA: 118.2,
  TSLA: 250.1,
  AMZN: 195.4,
  MSFT: 430.8,
  SPY: 565.3,
  AMD: 165.7,
  META: 520.6,
  UBXG: 7.8
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Approximate standard-normal noise from a sum of uniforms (cheap, no deps). */
const shock = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5

/**
 * The single source of truth for simulated prices. Both the sim market-data
 * provider and the sim broker share one instance, so streamed quotes and
 * mark-to-market P&L always agree.
 */
export class PriceEngine {
  private prices = new Map<string, number>()
  private opens = new Map<string, number>()
  private readonly volatility: number

  constructor(opts: { volatility?: number } = {}) {
    this.volatility = opts.volatility ?? 0.0008
  }

  price(symbol: string): number {
    let p = this.prices.get(symbol)
    if (p === undefined) {
      p = SEED_PRICES[symbol] ?? this.seedFor(symbol)
      this.prices.set(symbol, p)
      this.opens.set(symbol, p)
    }
    return p
  }

  /** Session-open reference price (for % change). */
  open(symbol: string): number {
    this.price(symbol)
    return this.opens.get(symbol) ?? 0
  }

  /** Advance the random walk one step and return the new price. */
  tick(symbol: string): number {
    const prev = this.price(symbol)
    const next = Math.max(0.01, prev * (1 + shock() * this.volatility * 3))
    const rounded = round2(next)
    this.prices.set(symbol, rounded)
    return rounded
  }

  /** Synthesize `limit` historical bars whose last close is the current price. */
  history(symbol: string, timeframe: Timeframe, limit: number): Bar[] {
    const step = TIMEFRAME_MS[timeframe]
    const now = Date.now()

    // Walk backwards from the live price to build plausible closes.
    const closes = new Array<number>(limit)
    let p = this.price(symbol)
    for (let i = limit - 1; i >= 0; i--) {
      closes[i] = p
      p = Math.max(0.01, p * (1 - shock() * this.volatility * 6))
    }

    const bars: Bar[] = []
    for (let i = 0; i < limit; i++) {
      const close = round2(closes[i])
      const open = i === 0 ? round2(close * (1 - this.volatility)) : bars[i - 1].close
      const wick = this.volatility * 5
      const high = round2(Math.max(open, close) * (1 + Math.random() * wick))
      const low = round2(Math.min(open, close) * (1 - Math.random() * wick))
      const volume = Math.round(20_000 + Math.random() * 180_000)
      const time = Math.floor((now - (limit - 1 - i) * step) / step) * step
      bars.push({ symbol, time, open, high, low, close, volume })
    }
    return bars
  }

  private seedFor(symbol: string): number {
    let h = 0
    for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0
    return round2(15 + (h % 4000) / 10) // ~$15–$415, stable per symbol
  }
}
