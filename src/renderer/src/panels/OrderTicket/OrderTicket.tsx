import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { useTicketStore } from '@renderer/state/ticketStore'
import { TicketForm } from './TicketForm'

const WIDTH = 320
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * Floating, draggable order ticket inside the main window. The ⧉ button pops it
 * out into its own OS window (which you can move to another monitor); Esc closes.
 */
export function OrderTicket(): ReactElement | null {
  const open = useTicketStore((s) => s.open)
  const close = useTicketStore((s) => s.close)
  const pos = useTicketStore((s) => s.pos)
  const setPos = useTicketStore((s) => s.setPos)
  const symbol = useWatchlistStore((s) => s.selected)

  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null)
  const p = pos ?? { x: Math.max(20, window.innerWidth - WIDTH - 24), y: 96 }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const popOut = (): void => {
    void window.api.windows.open('ticket', symbol ? { symbol } : {})
    close()
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    // Don't start a drag when pressing a header button — capturing the pointer
    // would swallow the button's click (pop-out / close).
    if ((e.target as HTMLElement).closest('button')) return
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
    const wasDragging = drag.current !== null
    drag.current = null
    if (wasDragging && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
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
        <div className="float-ticket__actions">
          <button className="float-ticket__close" onClick={popOut} title="Pop out into its own window">
            ⧉
          </button>
          <button className="float-ticket__close" onClick={close} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>
      <div className="float-ticket__body">
        <TicketForm />
      </div>
    </div>
  )
}
