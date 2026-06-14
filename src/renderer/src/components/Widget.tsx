import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { WIDGET_LABELS, type WidgetItem, type WidgetType } from '@shared/types'
import { activeWidgets, useLayoutStore } from '@renderer/state/layoutStore'
import { COLS, MARGIN, MIN_W, moveWidget } from '@renderer/lib/grid'
import { ChartPanel } from '@renderer/panels/Chart/ChartPanel'
import { AccountSummary } from '@renderer/panels/Account/AccountSummary'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { Positions } from '@renderer/panels/Positions/Positions'
import { Orders } from '@renderer/panels/Orders/Orders'

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

interface Gesture {
  base: WidgetItem[]
  sx: number
  sy: number
  bx: number
  by: number
  bw: number
  bh: number
  mode: 'move' | 'resize'
}

/** A grid-snapped, draggable + resizable widget. Reads its own geometry by id so
 * a gesture only re-renders the widgets that actually move. */
export function Widget({
  id,
  type,
  colWidth,
  rowHeight
}: {
  id: string
  type: WidgetType
  colWidth: number
  rowHeight: number
}): ReactElement | null {
  const item = useLayoutStore((s) => activeWidgets(s).find((w) => w.i === id))
  const setWidgets = useLayoutStore((s) => s.setWidgets)
  const removeWidget = useLayoutStore((s) => s.removeWidget)
  const gesture = useRef<Gesture | null>(null)
  const [active, setActive] = useState(false)

  if (!item) return null

  const colStep = colWidth + MARGIN
  const rowStep = rowHeight + MARGIN

  const start = (e: ReactPointerEvent, mode: 'move' | 'resize'): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = {
      base: activeWidgets(useLayoutStore.getState()),
      sx: e.clientX,
      sy: e.clientY,
      bx: item.x,
      by: item.y,
      bw: item.w,
      bh: item.h,
      mode
    }
    setActive(true)
  }

  const move = (e: ReactPointerEvent): void => {
    const g = gesture.current
    if (!g) return
    const dCol = Math.round((e.clientX - g.sx) / colStep)
    const dRow = Math.round((e.clientY - g.sy) / rowStep)
    if (g.mode === 'move') {
      setWidgets(moveWidget(g.base, id, g.bx + dCol, g.by + dRow, g.bw, g.bh))
    } else {
      const w = Math.min(g.bw + dCol, COLS - g.bx)
      setWidgets(moveWidget(g.base, id, g.bx, g.by, w, g.bh + dRow))
    }
  }

  const end = (e: ReactPointerEvent): void => {
    if (gesture.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    gesture.current = null
    setActive(false)
  }

  const onHeadDown = (e: ReactPointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    start(e, 'move')
  }
  const onRzDown = (e: ReactPointerEvent): void => {
    e.stopPropagation()
    start(e, 'resize')
  }

  const left = MARGIN + item.x * colStep
  const top = MARGIN + item.y * rowStep
  const width = item.w * colWidth + (item.w - 1) * MARGIN
  const height = item.h * rowHeight + (item.h - 1) * MARGIN

  return (
    <div
      className={`widget ${active ? 'widget--active' : ''}`}
      style={{ left, top, width, height, minWidth: MIN_W * colWidth }}
    >
      <div
        className="widget__head"
        onPointerDown={onHeadDown}
        onPointerMove={move}
        onPointerUp={end}
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
        onPointerMove={move}
        onPointerUp={end}
      />
    </div>
  )
}
