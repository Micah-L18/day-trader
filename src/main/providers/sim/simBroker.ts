import { randomUUID } from 'node:crypto'
import type { Account, Order, OrderRequest, Position } from '@shared/types'
import { TypedEmitter } from '../emitter'
import type { Broker, BrokerEvents } from '../types'
import { PriceEngine } from './priceEngine'

interface SeedPosition {
  symbol: string
  qty: number
  avgPrice: number
}

const SEED_POSITIONS: SeedPosition[] = [
  { symbol: 'AAPL', qty: 25, avgPrice: 210.4 },
  { symbol: 'NVDA', qty: 40, avgPrice: 102.8 }
]
const STARTING_CASH = 50_000

const round2 = (n: number): number => Math.round(n * 100) / 100
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0)

/**
 * A simulated paper broker. Holds account/positions/orders in memory, fills
 * market orders at the shared engine price, and marks to market once a second.
 * Order entry isn't wired into the UI until Phase 4 (behind the SafetyGate),
 * but the implementation is here so that phase is purely additive.
 */
export class SimBroker extends TypedEmitter<BrokerEvents> implements Broker {
  readonly name = 'sim'
  private readonly engine: PriceEngine
  private cash = STARTING_CASH
  private readonly positions = new Map<string, { qty: number; avgPrice: number }>()
  private readonly orders: Order[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(engine: PriceEngine) {
    super()
    this.engine = engine
    for (const p of SEED_POSITIONS) this.positions.set(p.symbol, { qty: p.qty, avgPrice: p.avgPrice })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.emit('positions', this.snapshotPositions())
      this.emit('account', this.snapshotAccount())
    }, 1_000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getAccount(): Promise<Account> {
    return Promise.resolve(this.snapshotAccount())
  }

  getPositions(): Promise<Position[]> {
    return Promise.resolve(this.snapshotPositions())
  }

  getOrders(): Promise<Order[]> {
    return Promise.resolve([...this.orders].reverse())
  }

  submitOrder(request: OrderRequest): Promise<Order> {
    const fillPrice =
      request.type === 'limit' && request.limitPrice
        ? request.limitPrice
        : this.engine.price(request.symbol)
    const signedQty = request.side === 'buy' ? request.qty : -request.qty
    const existing = this.positions.get(request.symbol) ?? { qty: 0, avgPrice: fillPrice }
    const newQty = existing.qty + signedQty

    // Weighted-average cost when growing the same direction; keep cost when reducing.
    const addingToSide = existing.qty === 0 || sign(existing.qty) === sign(signedQty)
    const avgPrice = addingToSide
      ? (existing.avgPrice * Math.abs(existing.qty) + fillPrice * Math.abs(signedQty)) /
        Math.max(1, Math.abs(newQty))
      : existing.avgPrice

    if (newQty === 0) this.positions.delete(request.symbol)
    else this.positions.set(request.symbol, { qty: newQty, avgPrice: round2(avgPrice) })
    this.cash -= signedQty * fillPrice

    const order: Order = {
      ...request,
      id: randomUUID(),
      status: 'filled',
      filledQty: request.qty,
      avgFillPrice: round2(fillPrice),
      submittedAt: Date.now()
    }
    this.orders.push(order)
    this.emit('order', order)
    this.emit('positions', this.snapshotPositions())
    this.emit('account', this.snapshotAccount())
    return Promise.resolve(order)
  }

  cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.find((o) => o.id === orderId)
    if (order && order.status !== 'filled') {
      order.status = 'canceled'
      this.emit('order', order)
    }
    return Promise.resolve()
  }

  private snapshotPositions(): Position[] {
    const out: Position[] = []
    for (const [symbol, p] of this.positions) {
      const mark = this.engine.price(symbol)
      out.push({
        symbol,
        qty: p.qty,
        avgPrice: round2(p.avgPrice),
        marketValue: round2(mark * p.qty),
        unrealizedPnl: round2((mark - p.avgPrice) * p.qty)
      })
    }
    return out
  }

  private snapshotAccount(): Account {
    const positionsValue = this.snapshotPositions().reduce((sum, p) => sum + p.marketValue, 0)
    return {
      equity: round2(this.cash + positionsValue),
      cash: round2(this.cash),
      buyingPower: round2(this.cash * 2)
    }
  }
}
