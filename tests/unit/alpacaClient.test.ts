import { describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { Quote } from '@shared/types'
import { AlpacaRest } from '../../src/main/providers/alpaca/rest'
import { AlpacaDataStream } from '../../src/main/providers/alpaca/dataStream'

const creds = { keyId: 'KID', secretKey: 'SEC' }

function mockFetch(data: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(data),
      text: () => Promise.resolve('')
    } as Response)
  )
}

describe('AlpacaRest', () => {
  it('fetches the account with auth headers', async () => {
    const f = mockFetch({ equity: '1000.50', cash: '500.25', buying_power: '2000' })
    const rest = new AlpacaRest(creds, { fetchFn: f as unknown as typeof fetch })

    expect(await rest.getAccount()).toEqual({ equity: 1000.5, cash: 500.25, buyingPower: 2000 })
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toBe('https://paper-api.alpaca.markets/v2/account')
    expect((init.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('KID')
  })

  it('requests recent bars (sort=desc) and returns them ascending', async () => {
    const f = mockFetch({
      bars: [
        { t: '2026-06-01T13:31:00Z', o: 1.5, h: 2, l: 1, c: 1.8, v: 500 }, // newest first
        { t: '2026-06-01T13:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 1000 }
      ]
    })
    const rest = new AlpacaRest(creds, { fetchFn: f as unknown as typeof fetch })

    const bars = await rest.getBars('aapl', '1Min', 50)
    // The API returns newest-first; output must be ascending (oldest first).
    expect(bars[0].time).toBeLessThan(bars[1].time)
    expect(bars[0]).toMatchObject({ symbol: 'AAPL', open: 1, close: 1.5 })

    const url = String(f.mock.calls[0][0])
    expect(url).toContain('/v2/stocks/AAPL/bars?timeframe=1Min&limit=50&feed=iex&sort=desc')
    expect(url).toContain('start=')
    expect(url).toContain('end=')
  })

  it('serializes a bracket order body', async () => {
    const f = mockFetch({
      id: 'o1',
      symbol: 'AAPL',
      side: 'buy',
      type: 'limit',
      qty: '10',
      filled_qty: '0',
      status: 'new',
      submitted_at: '2026-06-01T13:30:00Z'
    })
    const rest = new AlpacaRest(creds, { fetchFn: f as unknown as typeof fetch })

    await rest.submitOrder({
      symbol: 'AAPL',
      side: 'buy',
      qty: 10,
      type: 'limit',
      limitPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95
    })
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      symbol: 'AAPL',
      qty: '10',
      side: 'buy',
      type: 'limit',
      limit_price: '100',
      order_class: 'bracket',
      take_profit: { limit_price: '110' },
      stop_loss: { stop_price: '95' }
    })
  })
})

/** Minimal stand-in for a `ws` socket. */
class FakeWs {
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  private handlers: Record<string, (arg?: unknown) => void> = {}
  on(event: string, cb: (arg?: unknown) => void): this {
    this.handlers[event] = cb
    return this
  }
  send(s: string): void {
    this.sent.push(s)
  }
  close(): void {
    this.handlers.close?.()
  }
  emit(data: unknown): void {
    this.handlers.message?.(Buffer.from(JSON.stringify(data)))
  }
}

describe('AlpacaDataStream', () => {
  it('runs the connect→auth→subscribe handshake and emits a quote', () => {
    const fake = new FakeWs()
    const quotes: Quote[] = []
    const statuses: string[] = []
    const stream = new AlpacaDataStream({
      creds,
      url: 'wss://example',
      handlers: {
        onQuote: (q) => quotes.push(q),
        onTrade: () => undefined,
        onBar: () => undefined,
        onStatus: (s) => statuses.push(s)
      },
      wsFactory: () => fake as unknown as WebSocket
    })

    stream.subscribe(['AAPL'])
    stream.connect()

    fake.emit([{ T: 'success', msg: 'connected' }])
    expect(JSON.parse(fake.sent[0])).toMatchObject({ action: 'auth', key: 'KID', secret: 'SEC' })

    fake.emit([{ T: 'success', msg: 'authenticated' }])
    expect(JSON.parse(fake.sent[1])).toMatchObject({ action: 'subscribe', quotes: ['AAPL'] })

    fake.emit([{ T: 'q', S: 'AAPL', bp: 10, ap: 10.5, bs: 1, as: 2, t: '2026-06-01T13:30:00Z' }])
    expect(quotes[0]).toMatchObject({ symbol: 'AAPL', bid: 10, ask: 10.5, last: 10.25 })
    expect(statuses).toContain('connected')
  })
})
