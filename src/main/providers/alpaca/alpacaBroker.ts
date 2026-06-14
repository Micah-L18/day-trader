import type { Account, AlpacaCredentials, Order, OrderRequest, Position } from '@shared/types'
import { TypedEmitter } from '../emitter'
import type { Broker, BrokerEvents } from '../types'
import { AlpacaRest } from './rest'
import type { AlpacaProviderOptions } from './alpacaMarketData'

const POLL_MS = 4_000

/**
 * Broker backed by Alpaca REST. Account/positions/orders are polled on a short
 * interval and diffed so only changed orders are re-emitted. The real-time
 * trade-updates websocket arrives in Phase 4 alongside order entry; polling is
 * sufficient and robust for paper monitoring now.
 */
export class AlpacaBroker extends TypedEmitter<BrokerEvents> implements Broker {
  readonly name = 'alpaca'
  private readonly rest: AlpacaRest
  private readonly onStatus?: AlpacaProviderOptions['onStatus']
  private timer: ReturnType<typeof setInterval> | null = null
  private orderSignatures = new Map<string, string>()

  constructor(creds: AlpacaCredentials, opts: AlpacaProviderOptions = {}) {
    super()
    this.rest = new AlpacaRest(creds, { live: opts.live })
    this.onStatus = opts.onStatus
  }

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getAccount(): Promise<Account> {
    return this.rest.getAccount()
  }

  getPositions(): Promise<Position[]> {
    return this.rest.getPositions()
  }

  getOrders(): Promise<Order[]> {
    return this.rest.getOrders()
  }

  submitOrder(request: OrderRequest): Promise<Order> {
    return this.rest.submitOrder(request)
  }

  cancelOrder(orderId: string): Promise<void> {
    return this.rest.cancelOrder(orderId)
  }

  private async poll(): Promise<void> {
    try {
      const [account, positions, orders] = await Promise.all([
        this.rest.getAccount(),
        this.rest.getPositions(),
        this.rest.getOrders()
      ])
      this.onStatus?.('connected')
      this.emit('account', account)
      this.emit('positions', positions)

      // Emit only orders that are new or changed since the last poll.
      for (const o of [...orders].reverse()) {
        const sig = `${o.status}:${o.filledQty}:${o.avgFillPrice ?? ''}`
        if (this.orderSignatures.get(o.id) !== sig) {
          this.orderSignatures.set(o.id, sig)
          this.emit('order', o)
        }
      }
    } catch (err) {
      this.onStatus?.('error', (err as Error)?.message ?? String(err))
    }
  }
}
