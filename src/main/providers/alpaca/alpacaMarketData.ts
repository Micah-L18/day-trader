import type { AlpacaCredentials, Bar, ConnectionState, Timeframe, Trade } from '@shared/types'
import { TypedEmitter } from '../emitter'
import type { MarketDataEvents, MarketDataProvider } from '../types'
import { TIMEFRAME_MS } from '@shared/types'
import { AlpacaRest } from './rest'
import { AlpacaDataStream } from './dataStream'
import { alpacaEndpoints } from './endpoints'
import { mapBar, type AlpacaWsBar } from './mappers'

const STREAM_TF: Timeframe = '1Min'

export interface AlpacaProviderOptions {
  onStatus?: (state: ConnectionState, message?: string) => void
  live?: boolean
}

/**
 * Market data backed by Alpaca: REST for history, websocket for live quotes/
 * trades/bars. Alpaca streams completed minute bars, so we also synthesize a
 * forming bar from incoming trades to keep the current candle moving — matching
 * the contract the chart already consumes from the sim.
 */
export class AlpacaMarketData extends TypedEmitter<MarketDataEvents> implements MarketDataProvider {
  readonly name = 'alpaca'
  private readonly rest: AlpacaRest
  private readonly stream: AlpacaDataStream
  private readonly forming = new Map<string, { bucket: number; bar: Bar }>()

  constructor(creds: AlpacaCredentials, opts: AlpacaProviderOptions = {}) {
    super()
    this.rest = new AlpacaRest(creds, { live: opts.live })
    this.stream = new AlpacaDataStream({
      creds,
      url: alpacaEndpoints(opts.live ?? false).dataStream,
      handlers: {
        onQuote: (q) => this.emit('quote', q),
        onTrade: (t) => this.handleTrade(t),
        onBar: (b) => this.handleBar(b),
        onStatus: (s, m) => opts.onStatus?.(s, m)
      }
    })
  }

  start(): void {
    this.stream.connect()
  }

  stop(): void {
    this.stream.close()
  }

  subscribe(symbols: string[]): void {
    this.stream.subscribe(symbols)
  }

  unsubscribe(symbols: string[]): void {
    for (const s of symbols) this.forming.delete(s.toUpperCase())
    this.stream.unsubscribe(symbols)
  }

  getBars(symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]> {
    return this.rest.getBars(symbol, timeframe, limit)
  }

  private handleTrade(t: Trade): void {
    this.emit('trade', t)
    const step = TIMEFRAME_MS[STREAM_TF]
    const bucket = Math.floor(t.time / step) * step
    const current = this.forming.get(t.symbol)

    if (!current || current.bucket !== bucket) {
      if (current) this.emit('bar', { ...current.bar, timeframe: STREAM_TF, closed: true })
      const fresh: Bar = {
        symbol: t.symbol,
        time: bucket,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: t.size
      }
      this.forming.set(t.symbol, { bucket, bar: fresh })
      this.emit('bar', { ...fresh, timeframe: STREAM_TF, closed: false })
      return
    }

    const { bar } = current
    bar.high = Math.max(bar.high, t.price)
    bar.low = Math.min(bar.low, t.price)
    bar.close = t.price
    bar.volume += t.size
    this.emit('bar', { ...bar, timeframe: STREAM_TF, closed: false })
  }

  private handleBar(b: AlpacaWsBar): void {
    // Authoritative completed minute bar from Alpaca; supersedes the forming one.
    this.forming.delete(b.S)
    this.emit('bar', { ...mapBar(b.S, b), timeframe: STREAM_TF, closed: true })
  }
}
