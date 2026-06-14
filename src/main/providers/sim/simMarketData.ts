import {
  TIMEFRAME_MS,
  type Bar,
  type Quote,
  type Snapshot,
  type Timeframe,
  type Trade
} from '@shared/types'
import { TypedEmitter } from '../emitter'
import type { MarketDataEvents, MarketDataProvider } from '../types'
import { PriceEngine } from './priceEngine'

/** Timeframe of the live forming bar we stream (Phase 2 chart consumes this). */
const STREAM_TF: Timeframe = '1Min'
const TICK_MS = 250

interface FormingBar {
  bucket: number
  bar: Bar
}

export class SimMarketData extends TypedEmitter<MarketDataEvents> implements MarketDataProvider {
  readonly name = 'sim'
  private readonly engine: PriceEngine
  private readonly subscribed = new Set<string>()
  private readonly forming = new Map<string, FormingBar>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(engine: PriceEngine) {
    super()
    this.engine = engine
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tickAll(), TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  subscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribed.add(s.toUpperCase())
  }

  unsubscribe(symbols: string[]): void {
    for (const s of symbols) {
      const key = s.toUpperCase()
      this.subscribed.delete(key)
      this.forming.delete(key)
    }
  }

  getBars(symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]> {
    return Promise.resolve(this.engine.history(symbol.toUpperCase(), timeframe, limit))
  }

  getSnapshots(symbols: string[]): Promise<Snapshot[]> {
    return Promise.resolve(
      symbols.map((s) => {
        const sym = s.toUpperCase()
        const price = this.engine.price(sym)
        const open = this.engine.open(sym)
        return {
          symbol: sym,
          price,
          changePct: open > 0 ? ((price - open) / open) * 100 : 0,
          volume: Math.round(50_000 + Math.random() * 5_000_000)
        }
      })
    )
  }

  private tickAll(): void {
    const now = Date.now()
    for (const symbol of this.subscribed) {
      const price = this.engine.tick(symbol)
      const spread = Math.max(0.01, price * 0.0005)
      const quote: Quote = {
        symbol,
        time: now,
        bid: Math.round((price - spread / 2) * 100) / 100,
        ask: Math.round((price + spread / 2) * 100) / 100,
        bidSize: 100 * (1 + Math.floor(Math.random() * 20)),
        askSize: 100 * (1 + Math.floor(Math.random() * 20)),
        last: price
      }
      this.emit('quote', quote)

      if (Math.random() < 0.4) {
        const trade: Trade = {
          symbol,
          time: now,
          price,
          size: 100 * (1 + Math.floor(Math.random() * 10))
        }
        this.emit('trade', trade)
      }

      this.updateForming(symbol, price, now)
    }
  }

  private updateForming(symbol: string, price: number, now: number): void {
    const step = TIMEFRAME_MS[STREAM_TF]
    const bucket = Math.floor(now / step) * step
    const current = this.forming.get(symbol)

    if (!current || current.bucket !== bucket) {
      if (current) this.emit('bar', { ...current.bar, timeframe: STREAM_TF, closed: true })
      const fresh: Bar = {
        symbol,
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 100
      }
      this.forming.set(symbol, { bucket, bar: fresh })
      this.emit('bar', { ...fresh, timeframe: STREAM_TF, closed: false })
      return
    }

    const { bar } = current
    bar.high = Math.max(bar.high, price)
    bar.low = Math.min(bar.low, price)
    bar.close = price
    bar.volume += 100
    this.emit('bar', { ...bar, timeframe: STREAM_TF, closed: false })
  }
}
