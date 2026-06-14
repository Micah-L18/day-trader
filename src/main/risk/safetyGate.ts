import type {
  Account,
  FlattenResult,
  OrderRequest,
  Position,
  Quote,
  RiskDecision,
  RiskLimits,
  RiskRejectCode,
  RiskState
} from '@shared/types'
import type { Broker } from '../providers/types'
import type { Journal } from '../journal'

export const DEFAULT_LIMITS: RiskLimits = {
  maxOrderNotional: 10_000,
  maxPositionShares: 10_000,
  maxPositionNotional: 25_000,
  maxGrossExposure: 100_000,
  dailyLossLimit: 2_000,
  maxOrdersPerMinute: 30
}

const RATE_WINDOW_MS = 60_000

export interface SafetyGateOptions {
  getBroker: () => Broker
  limits?: Partial<RiskLimits>
  journal?: Journal
  onState?: (state: RiskState) => void
  now?: () => number
}

/**
 * The single submission chokepoint (PLAN.md §6.5, CLAUDE.md §2). The renderer
 * can only reach the broker through `submitOrder`, which runs every risk check,
 * logs the decision, and fails safe — a broker error is reported, never retried.
 */
export class SafetyGate {
  private readonly getBroker: () => Broker
  private readonly limits: RiskLimits
  private readonly journal: Journal
  private readonly onState?: (state: RiskState) => void
  private readonly now: () => number

  private killSwitch = false
  private startEquity: number | null = null
  private equity: number | null = null
  private buyingPower = Infinity
  private readonly positions = new Map<string, Position>()
  private readonly lastPrice = new Map<string, number>()
  private readonly acceptedAt: number[] = []

  constructor(opts: SafetyGateOptions) {
    this.getBroker = opts.getBroker
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits }
    this.journal = opts.journal ?? { log: () => undefined }
    this.onState = opts.onState
    this.now = opts.now ?? (() => Date.now())
  }

  // ---- live context (fed by the ProviderManager tap) ----

  setAccount(account: Account): void {
    this.equity = account.equity
    this.buyingPower = account.buyingPower
    if (this.startEquity === null) this.startEquity = account.equity
    this.emitState()
  }

  setPositions(positions: Position[]): void {
    this.positions.clear()
    for (const p of positions) this.positions.set(p.symbol, p)
  }

  setQuote(quote: Quote): void {
    this.lastPrice.set(quote.symbol, quote.last ?? (quote.bid + quote.ask) / 2)
  }

  // ---- controls ----

  setKillSwitch(on: boolean): void {
    this.killSwitch = on
    this.journal.log('kill_switch', { on })
    this.emitState()
  }

  resetDaily(): void {
    this.startEquity = this.equity
    this.journal.log('reset_daily', { startEquity: this.startEquity })
    this.emitState()
  }

  /** Drop the equity baseline so the next account (e.g. after a provider swap)
   * re-establishes start-of-day equity. */
  resetDailyBaseline(): void {
    this.startEquity = null
    this.equity = null
    this.emitState()
  }

  getState(): RiskState {
    return {
      killSwitch: this.killSwitch,
      dailyHalt: this.dailyHalt(),
      startEquity: this.startEquity,
      equity: this.equity,
      dailyPnl: this.dailyPnl(),
      limits: this.limits
    }
  }

  // ---- the chokepoint ----

  async submitOrder(req: OrderRequest): Promise<RiskDecision> {
    const decision = this.check(req)
    if (decision) {
      this.journal.log('risk_reject', { req, code: decision.code, reason: decision.reason })
      return decision
    }

    try {
      const order = await this.getBroker().submitOrder(req)
      this.acceptedAt.push(this.now())
      this.journal.log('order_submitted', { req, orderId: order.id, status: order.status })
      return { approved: true, order }
    } catch (err) {
      const reason = (err as Error)?.message ?? String(err)
      this.journal.log('broker_error', { req, reason })
      // Fail safe: report and stop. Never blind-retry a submission.
      return { approved: false, code: 'broker_error', reason }
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.journal.log('order_cancel', { orderId })
    await this.getBroker().cancelOrder(orderId)
  }

  /** Panic: cancel open orders and market-close every position. Risk-reducing,
   * so it runs even with the kill switch engaged. */
  async flattenAll(): Promise<FlattenResult> {
    this.journal.log('flatten_all', {})
    const broker = this.getBroker()
    let canceled = 0
    let closed = 0

    try {
      const orders = await broker.getOrders()
      for (const o of orders) {
        if (o.status === 'new' || o.status === 'accepted' || o.status === 'partially_filled') {
          await broker.cancelOrder(o.id).then(() => (canceled += 1)).catch(() => undefined)
        }
      }
    } catch (err) {
      this.journal.log('flatten_cancel_error', { reason: String(err) })
    }

    const positions = await broker.getPositions().catch(() => [] as Position[])
    for (const p of positions) {
      if (p.qty === 0) continue
      const close: OrderRequest = {
        symbol: p.symbol,
        side: p.qty > 0 ? 'sell' : 'buy',
        qty: Math.abs(p.qty),
        type: 'market'
      }
      await broker
        .submitOrder(close)
        .then(() => (closed += 1))
        .catch((err) => this.journal.log('flatten_close_error', { symbol: p.symbol, reason: String(err) }))
    }
    return { canceled, closed }
  }

  // ---- checks ----

  private check(req: OrderRequest): RiskDecision | null {
    if (this.killSwitch) return reject('kill_switch', 'Kill switch is engaged.')

    const reducing = this.isReducing(req)
    if (this.dailyHalt() && !reducing) {
      return reject('daily_halt', 'Daily loss limit reached — new entries are halted.')
    }

    if (!(req.qty > 0)) return reject('invalid_qty', 'Quantity must be greater than zero.')

    const price = this.priceFor(req)
    const notional = price * req.qty

    if (price > 0 && notional > this.limits.maxOrderNotional) {
      return reject('order_notional', `Order notional $${fmt(notional)} exceeds the $${fmt(this.limits.maxOrderNotional)} limit.`)
    }

    if (req.side === 'buy' && price > 0 && notional > this.buyingPower) {
      return reject('buying_power', `Order notional $${fmt(notional)} exceeds buying power $${fmt(this.buyingPower)}.`)
    }

    const currentQty = this.positions.get(req.symbol.toUpperCase())?.qty ?? 0
    const signed = req.side === 'buy' ? req.qty : -req.qty
    const resultShares = Math.abs(currentQty + signed)

    if (resultShares > this.limits.maxPositionShares) {
      return reject('position_shares', `Resulting ${resultShares} shares exceeds the ${this.limits.maxPositionShares}-share position limit.`)
    }
    if (price > 0 && resultShares * price > this.limits.maxPositionNotional) {
      return reject('position_notional', `Resulting position $${fmt(resultShares * price)} exceeds the $${fmt(this.limits.maxPositionNotional)} limit.`)
    }

    if (price > 0) {
      const projectedGross = this.projectedGross(currentQty, signed, price)
      if (projectedGross > this.limits.maxGrossExposure) {
        return reject('gross_exposure', `Projected gross exposure $${fmt(projectedGross)} exceeds the $${fmt(this.limits.maxGrossExposure)} limit.`)
      }
    }

    if (this.recentOrderCount() >= this.limits.maxOrdersPerMinute) {
      return reject('rate_limit', `Rate limit of ${this.limits.maxOrdersPerMinute} orders/minute reached.`)
    }

    return null
  }

  private isReducing(req: OrderRequest): boolean {
    const current = this.positions.get(req.symbol.toUpperCase())?.qty ?? 0
    if (current === 0) return false
    const signed = req.side === 'buy' ? 1 : -1
    return Math.sign(current) !== Math.sign(signed)
  }

  private priceFor(req: OrderRequest): number {
    if (req.type === 'limit' || req.type === 'stop_limit') return req.limitPrice ?? 0
    return (
      this.lastPrice.get(req.symbol.toUpperCase()) ??
      this.positions.get(req.symbol.toUpperCase())?.avgPrice ??
      0
    )
  }

  private priceForSymbol(symbol: string, fallback: number): number {
    return this.lastPrice.get(symbol) ?? fallback
  }

  private projectedGross(currentQty: number, signed: number, price: number): number {
    let gross = 0
    for (const [sym, pos] of this.positions) {
      gross += Math.abs(pos.qty * this.priceForSymbol(sym, pos.avgPrice))
    }
    const currentContribution = Math.abs(currentQty * price)
    const newContribution = Math.abs((currentQty + signed) * price)
    return gross - currentContribution + newContribution
  }

  private recentOrderCount(): number {
    const cutoff = this.now() - RATE_WINDOW_MS
    while (this.acceptedAt.length && this.acceptedAt[0] < cutoff) this.acceptedAt.shift()
    return this.acceptedAt.length
  }

  private dailyPnl(): number {
    if (this.startEquity === null || this.equity === null) return 0
    return this.equity - this.startEquity
  }

  private dailyHalt(): boolean {
    return this.dailyPnl() <= -this.limits.dailyLossLimit
  }

  private emitState(): void {
    this.onState?.(this.getState())
  }
}

function reject(code: RiskRejectCode, reason: string): RiskDecision {
  return { approved: false, code, reason }
}

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 })
