import { describe, expect, it } from 'vitest'
import type { Account, Order, OrderRequest, Position } from '@shared/types'
import type { Broker } from '../../src/main/providers/types'
import { SafetyGate } from '../../src/main/risk/safetyGate'

class FakeBroker implements Broker {
  readonly name = 'fake'
  submitted: OrderRequest[] = []
  canceled: string[] = []
  failNext = false
  orders: Order[] = []
  positions: Position[] = []

  start(): void {}
  stop(): void {}
  getAccount(): Promise<Account> {
    return Promise.resolve({ equity: 0, cash: 0, buyingPower: 0 })
  }
  getPositions(): Promise<Position[]> {
    return Promise.resolve(this.positions)
  }
  getOrders(): Promise<Order[]> {
    return Promise.resolve(this.orders)
  }
  submitOrder(req: OrderRequest): Promise<Order> {
    if (this.failNext) {
      this.failNext = false
      return Promise.reject(new Error('broker boom'))
    }
    this.submitted.push(req)
    return Promise.resolve({
      ...req,
      id: `o${this.submitted.length}`,
      status: 'filled',
      filledQty: req.qty,
      submittedAt: 0
    })
  }
  cancelOrder(id: string): Promise<void> {
    this.canceled.push(id)
    return Promise.resolve()
  }
  on(): () => void {
    return () => undefined
  }
}

const buy = (qty: number, symbol = 'AAPL'): OrderRequest => ({ symbol, side: 'buy', qty, type: 'market' })

function makeGate(broker: FakeBroker, limits = {}, now = () => 0): SafetyGate {
  return new SafetyGate({ getBroker: () => broker, limits, now })
}

describe('SafetyGate', () => {
  it('approves a valid order and forwards it to the broker', async () => {
    const broker = new FakeBroker()
    const gate = makeGate(broker)
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 9.99, ask: 10.01, bidSize: 1, askSize: 1, last: 10 })

    const decision = await gate.submitOrder(buy(5))
    expect(decision.approved).toBe(true)
    expect(decision.order?.id).toBe('o1')
    expect(broker.submitted).toHaveLength(1)
  })

  it('rejects non-positive quantity', async () => {
    const gate = makeGate(new FakeBroker())
    const decision = await gate.submitOrder(buy(0))
    expect(decision).toMatchObject({ approved: false, code: 'invalid_qty' })
  })

  it('honors the kill switch (and releasing it)', async () => {
    const broker = new FakeBroker()
    const gate = makeGate(broker)
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 10, ask: 10, bidSize: 1, askSize: 1, last: 10 })

    gate.setKillSwitch(true)
    expect((await gate.submitOrder(buy(1))).code).toBe('kill_switch')
    expect(broker.submitted).toHaveLength(0)

    gate.setKillSwitch(false)
    expect((await gate.submitOrder(buy(1))).approved).toBe(true)
  })

  it('rejects orders over the notional ceiling', async () => {
    const gate = makeGate(new FakeBroker(), { maxOrderNotional: 1000 })
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    expect((await gate.submitOrder(buy(50))).code).toBe('order_notional')
  })

  it('rejects buys over buying power', async () => {
    const gate = makeGate(new FakeBroker())
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    gate.setAccount({ equity: 1000, cash: 500, buyingPower: 500 } as Account)
    expect((await gate.submitOrder(buy(10))).code).toBe('buying_power') // 10*100 = 1000 > 500
  })

  it('rejects exceeding per-symbol share and notional limits', async () => {
    const sharesGate = makeGate(new FakeBroker(), { maxPositionShares: 5 })
    sharesGate.setQuote({ symbol: 'AAPL', time: 0, bid: 10, ask: 10, bidSize: 1, askSize: 1, last: 10 })
    expect((await sharesGate.submitOrder(buy(10))).code).toBe('position_shares')

    const notionalGate = makeGate(new FakeBroker(), { maxPositionNotional: 500 })
    notionalGate.setQuote({ symbol: 'AAPL', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    expect((await notionalGate.submitOrder(buy(10))).code).toBe('position_notional')
  })

  it('rejects exceeding gross exposure', async () => {
    const gate = makeGate(new FakeBroker(), { maxGrossExposure: 10_500 })
    gate.setPositions([
      { symbol: 'NVDA', qty: 100, avgPrice: 100, marketValue: 10_000, unrealizedPnl: 0 }
    ])
    gate.setQuote({ symbol: 'NVDA', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    expect((await gate.submitOrder(buy(10))).code).toBe('gross_exposure') // 10000 + 1000 > 10500
  })

  it('enforces the orders-per-minute rate limit', async () => {
    const broker = new FakeBroker()
    const gate = makeGate(broker, { maxOrdersPerMinute: 2 })
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 10, ask: 10, bidSize: 1, askSize: 1, last: 10 })

    expect((await gate.submitOrder(buy(1))).approved).toBe(true)
    expect((await gate.submitOrder(buy(1))).approved).toBe(true)
    expect((await gate.submitOrder(buy(1))).code).toBe('rate_limit')
    expect(broker.submitted).toHaveLength(2)
  })

  it('halts entries but allows exits after the daily loss limit', async () => {
    const broker = new FakeBroker()
    const gate = makeGate(broker, { dailyLossLimit: 2000 })
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 100, ask: 100, bidSize: 1, askSize: 1, last: 100 })
    gate.setAccount({ equity: 100_000, cash: 0, buyingPower: 1_000_000 } as Account)
    gate.setAccount({ equity: 97_000, cash: 0, buyingPower: 1_000_000 } as Account) // -3000

    // Entry (buy from flat) is blocked.
    expect((await gate.submitOrder(buy(1))).code).toBe('daily_halt')

    // Exit (sell that reduces a long) is allowed.
    gate.setPositions([{ symbol: 'AAPL', qty: 10, avgPrice: 100, marketValue: 1000, unrealizedPnl: 0 }])
    const exit = await gate.submitOrder({ symbol: 'AAPL', side: 'sell', qty: 5, type: 'market' })
    expect(exit.approved).toBe(true)
  })

  it('fails safe on a broker error without retrying', async () => {
    const broker = new FakeBroker()
    broker.failNext = true
    const gate = makeGate(broker)
    gate.setQuote({ symbol: 'AAPL', time: 0, bid: 10, ask: 10, bidSize: 1, askSize: 1, last: 10 })

    const decision = await gate.submitOrder(buy(1))
    expect(decision).toMatchObject({ approved: false, code: 'broker_error' })
    expect(broker.submitted).toHaveLength(0)
  })

  it('flattens positions and cancels open orders even with the kill switch on', async () => {
    const broker = new FakeBroker()
    broker.orders = [
      { ...buy(1), id: 'x', status: 'new', filledQty: 0, submittedAt: 0 }
    ]
    broker.positions = [
      { symbol: 'AAPL', qty: 10, avgPrice: 100, marketValue: 1000, unrealizedPnl: 0 },
      { symbol: 'TSLA', qty: -5, avgPrice: 200, marketValue: -1000, unrealizedPnl: 0 }
    ]
    const gate = makeGate(broker)
    gate.setKillSwitch(true)

    const result = await gate.flattenAll()
    expect(result).toEqual({ canceled: 1, closed: 2 })
    expect(broker.canceled).toContain('x')
    expect(broker.submitted).toEqual([
      { symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' },
      { symbol: 'TSLA', side: 'buy', qty: 5, type: 'market' }
    ])
  })
})
