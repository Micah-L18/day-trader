import type {
  Account,
  AlpacaCredentials,
  Bar,
  Order,
  OrderRequest,
  Position,
  Timeframe
} from '@shared/types'
import { alpacaEndpoints, type AlpacaEndpoints } from './endpoints'
import { TIMEFRAME_MS } from '../sim/priceEngine'
import {
  TIMEFRAME_PARAM,
  mapAccount,
  mapBar,
  mapOrder,
  mapPosition,
  type AlpacaAccount,
  type AlpacaBar,
  type AlpacaOrder,
  type AlpacaPosition
} from './mappers'

export type FetchFn = typeof fetch

/** Thin Alpaca REST client. `fetchFn` is injectable so tests run without network. */
export class AlpacaRest {
  private readonly creds: AlpacaCredentials
  private readonly ep: AlpacaEndpoints
  private readonly fetchFn: FetchFn

  constructor(creds: AlpacaCredentials, opts: { live?: boolean; fetchFn?: FetchFn } = {}) {
    this.creds = creds
    this.ep = alpacaEndpoints(opts.live ?? false)
    this.fetchFn = opts.fetchFn ?? fetch
  }

  private headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.creds.keyId,
      'APCA-API-SECRET-KEY': this.creds.secretKey,
      'Content-Type': 'application/json'
    }
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(url, { ...init, headers: this.headers() })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Alpaca ${res.status} ${res.statusText}: ${body}`)
    }
    return (await res.json()) as T
  }

  async getAccount(): Promise<Account> {
    return mapAccount(await this.request<AlpacaAccount>(`${this.ep.trading}/v2/account`))
  }

  async getPositions(): Promise<Position[]> {
    const arr = await this.request<AlpacaPosition[]>(`${this.ep.trading}/v2/positions`)
    return arr.map(mapPosition)
  }

  async getOrders(): Promise<Order[]> {
    const arr = await this.request<AlpacaOrder[]>(
      `${this.ep.trading}/v2/orders?status=all&limit=100&direction=desc`
    )
    return arr.map(mapOrder)
  }

  async getBars(symbol: string, timeframe: Timeframe, limit: number): Promise<Bar[]> {
    const tf = TIMEFRAME_PARAM[timeframe]
    // Pull the most-recent `limit` bars (sort=desc), reversed to ascending for
    // the chart. `end` is held back ~16 min because the free IEX feed rejects
    // queries inside the last 15 minutes; `start` reaches back far enough to
    // span weekends/holidays so we always get the last session.
    const endMs = Date.now() - 16 * 60_000
    const lookbackMs = Math.max(7 * 86_400_000, limit * TIMEFRAME_MS[timeframe] * 4)
    const start = new Date(endMs - lookbackMs).toISOString()
    const end = new Date(endMs).toISOString()
    const url =
      `${this.ep.data}/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars` +
      `?timeframe=${tf}&limit=${limit}&feed=${this.ep.feed}&sort=desc` +
      `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    const data = await this.request<{ bars: AlpacaBar[] | null }>(url)
    const bars = (data.bars ?? []).map((b) => mapBar(symbol.toUpperCase(), b))
    bars.reverse() // newest-first from the API → oldest-first for the chart
    return bars
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const body: Record<string, unknown> = {
      symbol: req.symbol.toUpperCase(),
      qty: String(req.qty),
      side: req.side,
      type: req.type,
      time_in_force: req.timeInForce ?? 'day'
    }
    if (req.limitPrice != null) body.limit_price = String(req.limitPrice)
    if (req.stopPrice != null) body.stop_price = String(req.stopPrice)
    if (req.takeProfitPrice != null || req.stopLossPrice != null) {
      body.order_class = 'bracket'
      if (req.takeProfitPrice != null) body.take_profit = { limit_price: String(req.takeProfitPrice) }
      if (req.stopLossPrice != null) body.stop_loss = { stop_price: String(req.stopLossPrice) }
    }
    const order = await this.request<AlpacaOrder>(`${this.ep.trading}/v2/orders`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    return mapOrder(order)
  }

  async cancelOrder(orderId: string): Promise<void> {
    const res = await this.fetchFn(`${this.ep.trading}/v2/orders/${orderId}`, {
      method: 'DELETE',
      headers: this.headers()
    })
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '')
      throw new Error(`Alpaca ${res.status} ${res.statusText}: ${body}`)
    }
  }
}
