import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { OrderRequest, OrderType, RiskDecision } from '@shared/types'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { useMarketStore } from '@renderer/state/marketStore'
import { useTicketStore } from '@renderer/state/ticketStore'
import { usd } from '@renderer/lib/format'

const WIDTH = 320
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * Floating, draggable order ticket. Opens from the Buy/Sell buttons; every
 * submit goes through window.api.orders.submit → SafetyGate. No backdrop, so
 * the rest of the app stays interactive while it's open.
 */
export function OrderTicket(): ReactElement | null {
  const open = useTicketStore((s) => s.open)
  const close = useTicketStore((s) => s.close)
  const pos = useTicketStore((s) => s.pos)
  const setPos = useTicketStore((s) => s.setPos)
  const side = useTicketStore((s) => s.side)
  const setSide = useTicketStore((s) => s.setSide)

  const symbol = useWatchlistStore((s) => s.selected)
  const quote = useMarketStore((s) => (symbol ? s.quotes[symbol] : undefined))
  const last = quote ? quote.last ?? quote.bid : undefined

  const [type, setType] = useState<OrderType>('market')
  const [qty, setQty] = useState('1')
  const [limit, setLimit] = useState('')
  const [stop, setStop] = useState('')
  const [bracket, setBracket] = useState(false)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [result, setResult] = useState<RiskDecision | null>(null)
  const [busy, setBusy] = useState(false)

  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null)
  const p = pos ?? { x: Math.max(20, window.innerWidth - WIDTH - 24), y: 96 }

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const onPointerDown = (e: ReactPointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, bx: p.x, by: p.y }
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d) return
    setPos({
      x: clamp(d.bx + (e.clientX - d.sx), 0, window.innerWidth - WIDTH),
      y: clamp(d.by + (e.clientY - d.sy), 0, window.innerHeight - 48)
    })
  }
  const onPointerUp = (e: ReactPointerEvent): void => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const needsLimit = type === 'limit' || type === 'stop_limit'
  const needsStop = type === 'stop' || type === 'stop_limit'
  const qtyNum = Number(qty)
  const est = last != null && qtyNum > 0 ? last * qtyNum : undefined
  const canSubmit = !!symbol && qtyNum > 0 && !busy

  const submit = async (): Promise<void> => {
    if (!symbol || !(qtyNum > 0)) return
    const req: OrderRequest = {
      symbol,
      side,
      qty: qtyNum,
      type,
      timeInForce: 'day',
      limitPrice: needsLimit && limit ? Number(limit) : undefined,
      stopPrice: needsStop && stop ? Number(stop) : undefined,
      takeProfitPrice: bracket && tp ? Number(tp) : undefined,
      stopLossPrice: bracket && sl ? Number(sl) : undefined
    }
    setBusy(true)
    try {
      setResult(await window.api.orders.submit(req))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="float-ticket" style={{ left: p.x, top: p.y, width: WIDTH }}>
      <div
        className="float-ticket__head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span>Order · {symbol ?? '—'}</span>
        <button className="float-ticket__close" onClick={close} title="Close (Esc)">
          ✕
        </button>
      </div>

      <div className="float-ticket__body">
        <div className="seg seg--full">
          <button
            className={`seg__btn ${side === 'buy' ? 'seg__btn--buy' : ''}`}
            onClick={() => setSide('buy')}
          >
            Buy
          </button>
          <button
            className={`seg__btn ${side === 'sell' ? 'seg__btn--sell' : ''}`}
            onClick={() => setSide('sell')}
          >
            Sell
          </button>
        </div>

        <div className="ticket__row">
          <select
            className="field field--sm"
            value={type}
            onChange={(e) => setType(e.target.value as OrderType)}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
            <option value="stop_limit">Stop limit</option>
          </select>
          <input
            className="field field--sm"
            type="number"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Qty"
          />
        </div>

        {(needsLimit || needsStop) && (
          <div className="ticket__row">
            {needsStop && (
              <input
                className="field field--sm"
                type="number"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
                placeholder="Stop price"
              />
            )}
            {needsLimit && (
              <input
                className="field field--sm"
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="Limit price"
              />
            )}
          </div>
        )}

        <label className="ticket__check">
          <input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} />{' '}
          Bracket (take-profit / stop-loss)
        </label>
        {bracket && (
          <div className="ticket__row">
            <input
              className="field field--sm"
              type="number"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              placeholder="Take profit"
            />
            <input
              className="field field--sm"
              type="number"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              placeholder="Stop loss"
            />
          </div>
        )}

        <div className="ticket__est">Est. {est != null ? usd(est) : '—'}</div>

        <button
          className={`btn btn--full ${side === 'buy' ? 'btn--buy' : 'btn--short'}`}
          onClick={submit}
          disabled={!canSubmit}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {qtyNum > 0 ? qtyNum : ''} {symbol ?? ''}
        </button>

        {result && (
          <div className={`ticket__result ${result.approved ? 'ok' : 'err'}`}>
            {result.approved
              ? `✓ ${result.order?.status ?? 'submitted'}${
                  result.order?.avgFillPrice != null ? ` @ ${usd(result.order.avgFillPrice)}` : ''
                }`
              : `✗ ${result.reason}`}
          </div>
        )}
      </div>
    </div>
  )
}
