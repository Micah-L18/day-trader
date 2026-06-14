import { useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { WIDGET_LABELS, type WidgetType } from '@shared/types'
import { activeWidgets, useLayoutStore } from '@renderer/state/layoutStore'
import { ChartPanel } from '@renderer/panels/Chart/ChartPanel'
import { AccountSummary } from '@renderer/panels/Account/AccountSummary'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { Positions } from '@renderer/panels/Positions/Positions'
import { Orders } from '@renderer/panels/Orders/Orders'

const MIN_W = 220
const MIN_H = 120

function renderWidget(type: WidgetType): ReactElement {
  switch (type) {
    case 'chart':
      return <ChartPanel />
    case 'account':
      return <AccountSummary />
    case 'watchlist':
      return <Watchlist />
    case 'positions':
      return <Positions />
    case 'orders':
      return <Orders />
  }
}

/** A free-form, draggable + resizable widget. Reads its own geometry by id so a
 * drag only re-renders this widget, not the whole board. */
export function Widget({ id, type }: { id: string; type: WidgetType }): ReactElement | null {
  const item = useLayoutStore((s) => activeWidgets(s).find((w) => w.i === id))
  const setWidget = useLayoutStore((s) => s.setWidget)
  const removeWidget = useLayoutStore((s) => s.removeWidget)
  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null)
  const rez = useRef<{ sx: number; sy: number; bw: number; bh: number } | null>(null)

  if (!item) return null

  const onHeadDown = (e: ReactPointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, bx: item.x, by: item.y }
  }
  const onHeadMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d) return
    setWidget(id, { x: Math.max(0, d.bx + (e.clientX - d.sx)), y: Math.max(0, d.by + (e.clientY - d.sy)) })
  }
  const onHeadUp = (e: ReactPointerEvent): void => {
    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drag.current = null
  }

  const onRzDown = (e: ReactPointerEvent): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    rez.current = { sx: e.clientX, sy: e.clientY, bw: item.w, bh: item.h }
  }
  const onRzMove = (e: ReactPointerEvent): void => {
    const r = rez.current
    if (!r) return
    setWidget(id, {
      w: Math.max(MIN_W, r.bw + (e.clientX - r.sx)),
      h: Math.max(MIN_H, r.bh + (e.clientY - r.sy))
    })
  }
  const onRzUp = (e: ReactPointerEvent): void => {
    if (rez.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    rez.current = null
  }

  return (
    <div className="widget" style={{ left: item.x, top: item.y, width: item.w, height: item.h }}>
      <div
        className="widget__head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={onHeadUp}
      >
        <span className="widget__title">{WIDGET_LABELS[type]}</span>
        <button className="widget__x" onClick={() => removeWidget(id)} title="Remove widget">
          ✕
        </button>
      </div>
      <div className="widget__body">{renderWidget(type)}</div>
      <div
        className="widget__resize"
        onPointerDown={onRzDown}
        onPointerMove={onRzMove}
        onPointerUp={onRzUp}
      />
    </div>
  )
}
