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

/** Bar aggregation intervals understood by providers. */
export type Timeframe = '1Sec' | '1Min' | '5Min' | '15Min' | '1Hour' | '1Day'

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1Sec': 1_000,
  '1Min': 60_000,
  '5Min': 300_000,
  '15Min': 900_000,
  '1Hour': 3_600_000,
  '1Day': 86_400_000
}

/** Intervals offered in the chart's interval bar, with display labels. */
export const CHART_INTERVALS: { tf: Timeframe; label: string }[] = [
  { tf: '1Min', label: '1m' },
  { tf: '5Min', label: '5m' },
  { tf: '15Min', label: '15m' },
  { tf: '1Hour', label: '1H' },
  { tf: '1Day', label: '1D' }
]

export interface Trade {
  symbol: string
  time: number
  price: number
  size: number
}

/**
 * A streamed bar. `closed` is false while the current interval is still
 * forming (so a chart can update the last candle) and true when it rolls over.
 */
export interface BarUpdate extends Bar {
  timeframe: Timeframe
  closed: boolean
}

/** Symbols the app subscribes to by default until the user customizes them. */
export const DEFAULT_WATCHLIST = [
  'AAPL',
  'NVDA',
  'TSLA',
  'AMZN',
  'MSFT',
  'SPY',
  'AMD',
  'META'
] as const

export interface TradingModeInfo {
  mode: TradingMode
  liveAllowed: boolean
  provider: string
}

export type ProviderKind = 'sim' | 'alpaca'

export interface AlpacaCredentials {
  keyId: string
  secretKey: string
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatus {
  provider: ProviderKind
  /** Market-data stream health. */
  market: ConnectionState
  /** Broker/trading health. */
  trading: ConnectionState
  message?: string
}

/** Non-secret settings surfaced to the renderer (keys themselves never leave main). */
export interface SettingsInfo {
  provider: ProviderKind
  hasAlpacaKeys: boolean
  alpacaKeyIdMasked: string | null
  encryptionAvailable: boolean
}

export interface SaveSettingsInput {
  provider: ProviderKind
  /** Omitted when the user isn't changing the stored keys. */
  alpaca?: AlpacaCredentials
}

export interface TestConnectionResult {
  ok: boolean
  message: string
}

// ---- Live-trading gate ----

/** The user must type this exactly to arm live trading (the on-screen confirm). */
export const LIVE_CONFIRM_PHRASE = 'ENABLE LIVE'

export interface LiveState {
  /** Env gate satisfied: app mode=live AND ALLOW_LIVE_TRADING=1. */
  capable: boolean
  /** Runtime gate satisfied: user typed the confirmation and orders route live. */
  armed: boolean
  hasLiveKeys: boolean
}

export interface ArmLiveInput {
  confirm: string
  live?: AlpacaCredentials
}

export interface ArmLiveResult {
  ok: boolean
  armed: boolean
  message: string
}

// ---- Risk / SafetyGate ----

export interface RiskLimits {
  /** Hard ceiling on a single order's notional ($). */
  maxOrderNotional: number
  /** Max absolute shares held per symbol after the order. */
  maxPositionShares: number
  /** Max absolute notional per symbol after the order ($). */
  maxPositionNotional: number
  /** Max sum of |position notional| across all symbols ($). */
  maxGrossExposure: number
  /** Loss from start-of-day equity that halts new entries ($). */
  dailyLossLimit: number
  /** Cap on accepted orders per rolling minute. */
  maxOrdersPerMinute: number
}

export type RiskRejectCode =
  | 'kill_switch'
  | 'daily_halt'
  | 'invalid_qty'
  | 'order_notional'
  | 'buying_power'
  | 'position_shares'
  | 'position_notional'
  | 'gross_exposure'
  | 'rate_limit'
  | 'broker_error'

export interface RiskDecision {
  approved: boolean
  order?: Order
  reason?: string
  code?: RiskRejectCode
}

export interface RiskState {
  killSwitch: boolean
  dailyHalt: boolean
  startEquity: number | null
  equity: number | null
  dailyPnl: number
  limits: RiskLimits
}

export interface FlattenResult {
  canceled: number
  closed: number
}

/** Panels that can be popped out into their own OS window. */
export type PanelKind = 'ticket' | 'chart' | 'watchlist' | 'positions' | 'orders'

// ---- Layouts ----

export interface Layout {
  id: string
  name: string
  railWidth: number
  interval: Timeframe
}

export interface LayoutsState {
  layouts: Layout[]
  activeId: string
}

// ---- Hotkeys ----

export type HotkeyAction =
  | 'openBuy'
  | 'openSell'
  | 'flatten'
  | 'killSwitch'
  | 'cancelAll'
  | 'nextSymbol'
  | 'prevSymbol'
  | 'cycleInterval'
  | 'focusSearch'
  | 'popoutChart'
  | 'openSettings'

/** Binding strings: lowercase, modifiers first in mod+alt+shift order, e.g.
 * "b", "shift+f", "mod+,". `mod` = ⌘ on macOS / Ctrl elsewhere. */
export type Keymap = Record<HotkeyAction, string>

export const DEFAULT_KEYMAP: Keymap = {
  openBuy: 'b',
  openSell: 's',
  flatten: 'shift+f',
  killSwitch: 'shift+k',
  cancelAll: 'shift+c',
  nextSymbol: ']',
  prevSymbol: '[',
  cycleInterval: 'i',
  focusSearch: '/',
  popoutChart: 'shift+p',
  openSettings: 'mod+,'
}
