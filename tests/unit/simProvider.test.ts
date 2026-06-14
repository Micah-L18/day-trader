import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Quote } from '@shared/types'
import { PriceEngine } from '../../src/main/providers/sim/priceEngine'
import { SimMarketData } from '../../src/main/providers/sim/simMarketData'
import { SimBroker } from '../../src/main/providers/sim/simBroker'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PriceEngine', () => {
  it('synthesizes history ending at the current price', () => {
    const engine = new PriceEngine()
    const bars = engine.history('AAPL', '1Min', 50)
    expect(bars).toHaveLength(50)
    expect(bars.at(-1)?.close).toBeCloseTo(engine.price('AAPL'), 2)
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(b.low)
      expect(b.low).toBeGreaterThan(0)
      expect(b.volume).toBeGreaterThan(0)
    }
  })

  it('gives unknown symbols a stable seed price', () => {
    const engine = new PriceEngine()
    const first = engine.price('ZZZZ')
    expect(first).toBe(engine.price('ZZZZ'))
    expect(first).toBeGreaterThan(0)
  })
})

describe('SimMarketData', () => {
  it('streams quotes and a forming bar for subscribed symbols', () => {
    vi.useFakeTimers()
    const md = new SimMarketData(new PriceEngine())
    const quotes: Quote[] = []
    let bars = 0
    md.on('quote', (q) => quotes.push(q))
    md.on('bar', () => bars++)

    md.subscribe(['AAPL'])
    md.start()
    vi.advanceTimersByTime(1000) // ~4 ticks @ 250ms
    md.stop()

    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes[0].symbol).toBe('AAPL')
    expect(quotes[0].ask).toBeGreaterThan(quotes[0].bid)
    expect(bars).toBeGreaterThan(0)
  })

  it('stops emitting after unsubscribe', () => {
    vi.useFakeTimers()
    const md = new SimMarketData(new PriceEngine())
    let count = 0
    md.on('quote', () => count++)
    md.subscribe(['MSFT'])
    md.start()
    vi.advanceTimersByTime(500)
    const afterSub = count
    md.unsubscribe(['MSFT'])
    vi.advanceTimersByTime(500)
    md.stop()
    expect(afterSub).toBeGreaterThan(0)
    expect(count).toBe(afterSub) // no further quotes
  })
})

describe('SimBroker', () => {
  it('reports seeded positions marked to market', async () => {
    const broker = new SimBroker(new PriceEngine())
    const positions = await broker.getPositions()
    const aapl = positions.find((p) => p.symbol === 'AAPL')
    expect(aapl?.qty).toBe(25)
    expect(typeof aapl?.unrealizedPnl).toBe('number')

    const account = await broker.getAccount()
    expect(account.equity).toBeGreaterThan(0)
    expect(account.buyingPower).toBeGreaterThanOrEqual(account.cash)
  })

  it('fills a market buy and updates positions, orders, and emits events', async () => {
    const broker = new SimBroker(new PriceEngine())
    const orderEvents: string[] = []
    broker.on('order', (o) => orderEvents.push(o.id))

    const order = await broker.submitOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' })
    expect(order.status).toBe('filled')
    expect(order.filledQty).toBe(10)
    expect(orderEvents).toContain(order.id)

    const positions = await broker.getPositions()
    expect(positions.find((p) => p.symbol === 'MSFT')?.qty).toBe(10)

    const orders = await broker.getOrders()
    expect(orders[0].id).toBe(order.id)
  })
})
