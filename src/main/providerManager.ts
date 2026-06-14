import { BrowserWindow } from 'electron'
import type {
  Account,
  ConnectionState,
  ConnectionStatus,
  Position,
  ProviderKind,
  Quote
} from '@shared/types'
import type { Broker, MarketDataProvider, Providers } from './providers/types'

type StatusCb = (which: 'market' | 'trading', state: ConnectionState, message?: string) => void
export type BuildProviders = (kind: ProviderKind, onStatus: StatusCb) => Providers

/** Live-context observer (e.g. the SafetyGate), notified regardless of provider. */
export interface ContextTap {
  onAccount?: (a: Account) => void
  onPositions?: (p: Position[]) => void
  onQuote?: (q: Quote) => void
}

/**
 * Owns the active provider pair and can hot-swap Sim↔Alpaca at runtime: it
 * tears down stream wiring, rebuilds, re-wires, restarts, and re-subscribes the
 * tracked watchlist. IPC handlers read `marketData`/`broker` through this, so a
 * swap is transparent to the renderer.
 */
export class ProviderManager {
  private current: Providers
  private unwire: Array<() => void> = []
  private readonly subscribed = new Set<string>()
  private status: ConnectionStatus
  private readonly build: BuildProviders
  private tap: ContextTap = {}

  constructor(kind: ProviderKind, build: BuildProviders) {
    this.build = build
    this.status = { provider: kind, market: 'idle', trading: 'idle' }
    this.current = build(kind, this.handleStatus)
    this.wireAndStart(kind)
  }

  /** Register a live-context observer (the SafetyGate). Survives provider swaps. */
  setContextTap(tap: ContextTap): void {
    this.tap = tap
  }

  get marketData(): MarketDataProvider {
    return this.current.marketData
  }

  get broker(): Broker {
    return this.current.broker
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  subscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribed.add(s.toUpperCase())
    this.current.marketData.subscribe([...this.subscribed])
  }

  switch(kind: ProviderKind): void {
    this.teardown()
    this.status = { provider: kind, market: 'idle', trading: 'idle' }
    this.current = this.build(kind, this.handleStatus)
    this.wireAndStart(kind)
    this.current.marketData.subscribe([...this.subscribed])
  }

  stop(): void {
    this.teardown()
  }

  private wireAndStart(kind: ProviderKind): void {
    const { marketData: md, broker: bk } = this.current
    this.unwire = [
      md.on('quote', (q) => {
        this.broadcast('stream:quote', q)
        this.tap.onQuote?.(q)
      }),
      md.on('bar', (b) => this.broadcast('stream:bar', b)),
      md.on('trade', (t) => this.broadcast('stream:trade', t)),
      bk.on('order', (o) => this.broadcast('stream:order', o)),
      bk.on('positions', (p) => {
        this.broadcast('stream:positions', p)
        this.tap.onPositions?.(p)
      }),
      bk.on('account', (a) => {
        this.broadcast('stream:account', a)
        this.tap.onAccount?.(a)
      })
    ]
    md.start()
    bk.start()
    // The sim is always "connected"; Alpaca reports via handleStatus.
    if (kind === 'sim') this.status = { provider: 'sim', market: 'connected', trading: 'connected' }
    this.broadcast('stream:status', this.status)
  }

  private teardown(): void {
    for (const u of this.unwire) u()
    this.unwire = []
    this.current.marketData.stop()
    this.current.broker.stop()
  }

  private handleStatus = (
    which: 'market' | 'trading',
    state: ConnectionState,
    message?: string
  ): void => {
    if (which === 'market') this.status.market = state
    else this.status.trading = state
    this.status.message = message
    this.broadcast('stream:status', this.status)
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}
