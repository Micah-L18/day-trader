import type {
  Account,
  Bar,
  BarUpdate,
  Order,
  OrderRequest,
  Position,
  Quote,
  Timeframe,
  Trade
} from '@shared/types'

export interface MarketDataEvents {
  quote: Quote
  bar: BarUpdate
  trade: Trade
}

export interface BrokerEvents {
  order: Order
  positions: Position[]
  account: Account
}

/**
 * Streams and queries market data. Implemented by `SimMarketData` now and by an
 * Alpaca-backed provider in Phase 3 — the renderer never sees the difference.
 */
export interface MarketDataProvider {
  readonly name: string
  start(): void
  stop(): void
  subscribe(symbols: string[]): void
  unsubscribe(symbols: string[]): void
  getBars(symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]>
  on<K extends keyof MarketDataEvents>(
    event: K,
    cb: (payload: MarketDataEvents[K]) => void
  ): () => void
}

/**
 * Account/position/order access and the single point that reaches a broker.
 * In Phase 4 every order is funnelled here through the SafetyGate.
 */
export interface Broker {
  readonly name: string
  start(): void
  stop(): void
  getAccount(): Promise<Account>
  getPositions(): Promise<Position[]>
  getOrders(): Promise<Order[]>
  submitOrder(request: OrderRequest): Promise<Order>
  cancelOrder(orderId: string): Promise<void>
  on<K extends keyof BrokerEvents>(event: K, cb: (payload: BrokerEvents[K]) => void): () => void
}

export interface Providers {
  marketData: MarketDataProvider
  broker: Broker
}
