import type {
  Account,
  Bar,
  Order,
  OrderStatus,
  OrderType,
  Position,
  Quote,
  Side,
  TimeInForce,
  Timeframe,
  Trade
} from '@shared/types'

// ---- REST shapes (subset of Alpaca's responses we use) ----

export interface AlpacaBar {
  t: string // RFC-3339 timestamp
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface AlpacaAccount {
  equity: string
  cash: string
  buying_power: string
}

export interface AlpacaPosition {
  symbol: string
  qty: string
  avg_entry_price: string
  market_value: string
  unrealized_pl: string
}

export interface AlpacaOrder {
  id: string
  symbol: string
  side: string
  type?: string
  order_type?: string
  qty: string | null
  filled_qty: string | null
  limit_price?: string | null
  stop_price?: string | null
  filled_avg_price?: string | null
  status: string
  submitted_at: string
  time_in_force?: string
}

/** Alpaca timeframe query value for each of our timeframes. */
export const TIMEFRAME_PARAM: Record<Timeframe, string> = {
  '1Sec': '1Min', // sub-minute history isn't used; fall back to 1Min
  '1Min': '1Min',
  '5Min': '5Min',
  '15Min': '15Min',
  '1Hour': '1Hour',
  '1Day': '1Day'
}

const ORDER_STATUS: Record<string, OrderStatus> = {
  new: 'new',
  accepted: 'accepted',
  pending_new: 'pending',
  accepted_for_bidding: 'accepted',
  partially_filled: 'partially_filled',
  filled: 'filled',
  done_for_day: 'accepted',
  canceled: 'canceled',
  expired: 'canceled',
  replaced: 'accepted',
  pending_cancel: 'pending',
  pending_replace: 'pending',
  rejected: 'rejected',
  suspended: 'pending',
  calculated: 'pending',
  held: 'pending',
  stopped: 'pending'
}

export const mapOrderStatus = (s: string): OrderStatus => ORDER_STATUS[s] ?? 'pending'

export function mapBar(symbol: string, b: AlpacaBar): Bar {
  return { symbol, time: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }
}

export function mapAccount(a: AlpacaAccount): Account {
  return { equity: Number(a.equity), cash: Number(a.cash), buyingPower: Number(a.buying_power) }
}

export function mapPosition(p: AlpacaPosition): Position {
  return {
    symbol: p.symbol,
    qty: Number(p.qty),
    avgPrice: Number(p.avg_entry_price),
    marketValue: Number(p.market_value),
    unrealizedPnl: Number(p.unrealized_pl)
  }
}

export function mapOrder(o: AlpacaOrder): Order {
  return {
    id: o.id,
    symbol: o.symbol,
    side: o.side as Side,
    qty: Number(o.qty ?? o.filled_qty ?? 0),
    type: (o.type ?? o.order_type ?? 'market') as OrderType,
    limitPrice: o.limit_price != null ? Number(o.limit_price) : undefined,
    stopPrice: o.stop_price != null ? Number(o.stop_price) : undefined,
    timeInForce: (o.time_in_force as TimeInForce | undefined) ?? 'day',
    status: mapOrderStatus(o.status),
    filledQty: Number(o.filled_qty ?? 0),
    avgFillPrice: o.filled_avg_price != null ? Number(o.filled_avg_price) : undefined,
    submittedAt: Date.parse(o.submitted_at)
  }
}

// ---- Market-data websocket shapes ----

export interface AlpacaWsQuote {
  T: 'q'
  S: string
  bp: number
  ap: number
  bs: number
  as: number
  t: string
}

export interface AlpacaWsTrade {
  T: 't'
  S: string
  p: number
  s: number
  t: string
}

export interface AlpacaWsBar {
  T: 'b'
  S: string
  o: number
  h: number
  l: number
  c: number
  v: number
  t: string
}

export function mapWsQuote(q: AlpacaWsQuote): Quote {
  return {
    symbol: q.S,
    time: Date.parse(q.t),
    bid: q.bp,
    ask: q.ap,
    bidSize: q.bs,
    askSize: q.as,
    last: (q.bp + q.ap) / 2
  }
}

export function mapWsTrade(t: AlpacaWsTrade): Trade {
  return { symbol: t.S, time: Date.parse(t.t), price: t.p, size: t.s }
}
