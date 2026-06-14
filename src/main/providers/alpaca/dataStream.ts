import WebSocket from 'ws'
import type { AlpacaCredentials, ConnectionState, Quote, Trade } from '@shared/types'
import {
  mapWsQuote,
  mapWsTrade,
  type AlpacaWsBar,
  type AlpacaWsQuote,
  type AlpacaWsTrade
} from './mappers'

export type WsFactory = (url: string) => WebSocket

export interface DataStreamHandlers {
  onQuote: (q: Quote) => void
  onTrade: (t: Trade) => void
  onBar: (b: AlpacaWsBar) => void
  onStatus: (state: ConnectionState, message?: string) => void
}

const MAX_BACKOFF_MS = 30_000

/**
 * Alpaca market-data websocket (v2). Handles the connect→auth→subscribe
 * handshake, resubscribes on reconnect, and backs off on disconnect. Fail-safe:
 * a dropped socket reconnects but never blindly replays orders (data only).
 */
export class AlpacaDataStream {
  private ws: WebSocket | null = null
  private readonly creds: AlpacaCredentials
  private readonly url: string
  private readonly handlers: DataStreamHandlers
  private readonly factory: WsFactory
  private readonly symbols = new Set<string>()
  private authed = false
  private closedByUs = false
  private backoff = 1_000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: {
    creds: AlpacaCredentials
    url: string
    handlers: DataStreamHandlers
    wsFactory?: WsFactory
  }) {
    this.creds = opts.creds
    this.url = opts.url
    this.handlers = opts.handlers
    this.factory = opts.wsFactory ?? ((u) => new WebSocket(u))
  }

  connect(): void {
    this.closedByUs = false
    this.authed = false
    this.handlers.onStatus('connecting')
    const ws = this.factory(this.url)
    this.ws = ws
    ws.on('message', (data: WebSocket.RawData) => this.onMessage(data))
    ws.on('close', () => this.onClose())
    ws.on('error', (err: Error) => this.handlers.onStatus('error', err?.message ?? String(err)))
  }

  subscribe(symbols: string[]): void {
    let changed = false
    for (const s of symbols) {
      const u = s.toUpperCase()
      if (!this.symbols.has(u)) {
        this.symbols.add(u)
        changed = true
      }
    }
    if (changed && this.authed) this.send({ action: 'subscribe', ...this.channels([...this.symbols]) })
  }

  unsubscribe(symbols: string[]): void {
    const removed = symbols.map((s) => s.toUpperCase()).filter((s) => this.symbols.delete(s))
    if (removed.length && this.authed) {
      this.send({ action: 'unsubscribe', ...this.channels(removed) })
    }
  }

  close(): void {
    this.closedByUs = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.authed = false
    this.ws?.close()
    this.ws = null
  }

  private channels(symbols: string[]): { trades: string[]; quotes: string[]; bars: string[] } {
    return { trades: symbols, quotes: symbols, bars: symbols }
  }

  private send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  private onMessage(data: WebSocket.RawData): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      return
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    for (const m of messages) this.handle(m as Record<string, unknown>)
  }

  private handle(m: Record<string, unknown>): void {
    switch (m.T) {
      case 'success':
        if (m.msg === 'connected') {
          this.send({ action: 'auth', key: this.creds.keyId, secret: this.creds.secretKey })
        } else if (m.msg === 'authenticated') {
          this.authed = true
          this.backoff = 1_000
          this.handlers.onStatus('connected')
          if (this.symbols.size) this.send({ action: 'subscribe', ...this.channels([...this.symbols]) })
        }
        return
      case 'error':
        this.handlers.onStatus('error', typeof m.msg === 'string' ? m.msg : 'stream error')
        return
      case 'q':
        this.handlers.onQuote(mapWsQuote(m as unknown as AlpacaWsQuote))
        return
      case 't':
        this.handlers.onTrade(mapWsTrade(m as unknown as AlpacaWsTrade))
        return
      case 'b':
        this.handlers.onBar(m as unknown as AlpacaWsBar)
        return
      default:
        // subscription acks and other control messages: ignore
        return
    }
  }

  private onClose(): void {
    this.authed = false
    this.ws = null
    if (this.closedByUs) return
    this.handlers.onStatus('connecting', 'reconnecting…')
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
  }
}
