/**
 * Core domain types shared across main, preload, and renderer.
 *
 * Prices and quantities are kept as `string` at the boundary to avoid binary
 * float drift; convert to decimal.js / integer cents at the edges that do math.
 * These are intentionally minimal for Phase 0 and grow with later phases.
 */

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit'
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok'
export type TradingMode = 'backtest' | 'paper' | 'live'

export interface Bar {
  symbol: string
  /** epoch milliseconds (UTC) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Quote {
  symbol: string
  time: number
  bid: number
  ask: number
  bidSize: number
  askSize: number
  last?: number
}

export interface Position {
  symbol: string
  qty: number
  avgPrice: number
  marketValue: number
  unrealizedPnl: number
}

export interface Account {
  equity: number
  cash: number
  buyingPower: number
}

export interface OrderRequest {
  symbol: string
  side: Side
  qty: number
  type: OrderType
  limitPrice?: number
  stopPrice?: number
  timeInForce?: TimeInForce
  /** Optional bracket legs — protective stop / take-profit placed at the broker. */
  takeProfitPrice?: number
  stopLossPrice?: number
}

export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'partially_filled'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'pending'

export interface Order extends OrderRequest {
  id: string
  status: OrderStatus
  filledQty: number
  avgFillPrice?: number
  submittedAt: number
  reason?: string
}
