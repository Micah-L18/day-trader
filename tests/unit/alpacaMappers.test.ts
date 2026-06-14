import { describe, expect, it } from 'vitest'
import {
  TIMEFRAME_PARAM,
  mapAccount,
  mapBar,
  mapOrder,
  mapOrderStatus,
  mapPosition,
  mapWsQuote,
  mapWsTrade
} from '../../src/main/providers/alpaca/mappers'

describe('alpaca mappers', () => {
  it('maps a bar (timestamp → ms)', () => {
    const bar = mapBar('AAPL', { t: '2026-06-01T13:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 })
    expect(bar).toEqual({
      symbol: 'AAPL',
      time: Date.parse('2026-06-01T13:30:00Z'),
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 1000
    })
  })

  it('maps account/position numbers from strings', () => {
    expect(mapAccount({ equity: '1000.50', cash: '500.25', buying_power: '2000' })).toEqual({
      equity: 1000.5,
      cash: 500.25,
      buyingPower: 2000
    })
    expect(
      mapPosition({
        symbol: 'NVDA',
        qty: '40',
        avg_entry_price: '102.8',
        market_value: '4800',
        unrealized_pl: '688'
      })
    ).toEqual({ symbol: 'NVDA', qty: 40, avgPrice: 102.8, marketValue: 4800, unrealizedPnl: 688 })
  })

  it('maps order status and fields', () => {
    expect(mapOrderStatus('partially_filled')).toBe('partially_filled')
    expect(mapOrderStatus('expired')).toBe('canceled')
    expect(mapOrderStatus('weird_unknown')).toBe('pending')

    const order = mapOrder({
      id: 'o1',
      symbol: 'AAPL',
      side: 'buy',
      type: 'limit',
      qty: '10',
      filled_qty: '4',
      limit_price: '100.5',
      filled_avg_price: '100.4',
      status: 'partially_filled',
      submitted_at: '2026-06-01T13:30:00Z',
      time_in_force: 'gtc'
    })
    expect(order).toMatchObject({
      id: 'o1',
      symbol: 'AAPL',
      side: 'buy',
      type: 'limit',
      qty: 10,
      filledQty: 4,
      limitPrice: 100.5,
      avgFillPrice: 100.4,
      status: 'partially_filled',
      timeInForce: 'gtc'
    })
  })

  it('maps ws quote (last = mid) and trade', () => {
    expect(
      mapWsQuote({ T: 'q', S: 'AAPL', bp: 10, ap: 10.5, bs: 1, as: 2, t: '2026-06-01T13:30:00Z' })
    ).toMatchObject({ symbol: 'AAPL', bid: 10, ask: 10.5, bidSize: 1, askSize: 2, last: 10.25 })
    expect(
      mapWsTrade({ T: 't', S: 'AAPL', p: 10.3, s: 100, t: '2026-06-01T13:30:00Z' })
    ).toMatchObject({ symbol: 'AAPL', price: 10.3, size: 100 })
  })

  it('falls back sub-minute timeframes to 1Min', () => {
    expect(TIMEFRAME_PARAM['1Sec']).toBe('1Min')
    expect(TIMEFRAME_PARAM['1Day']).toBe('1Day')
  })
})
