import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { WidgetType } from '@shared/types'
import { activeWidgets, useLayoutStore } from '@renderer/state/layoutStore'
import { COLS, MARGIN, ROW_H } from '@renderer/lib/grid'
import { Widget } from '@renderer/components/Widget'

/** The widget workspace. Re-renders only when the set of widgets (ids/types) or
 * the board width changes; individual widgets handle their own move/resize. */
export function WidgetBoard(): ReactElement {
  const meta = useLayoutStore((s) => activeWidgets(s).map((w) => `${w.i}|${w.type}`).join(','))
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const items = meta
    ? meta.split(',').map((s) => {
        const [i, type] = s.split('|')
        return { i, type: type as WidgetType }
      })
    : []

  const colWidth = width > 0 ? (width - MARGIN * (COLS + 1)) / COLS : 0
  const ready = colWidth > 0

  return (
    <div
      ref={ref}
      className="widgetboard"
      style={
        ready
          ? {
              backgroundSize: `${colWidth + MARGIN}px ${ROW_H + MARGIN}px`,
              backgroundPosition: `${MARGIN}px ${MARGIN}px`
            }
          : undefined
      }
    >
      {items.length === 0 && (
        <div className="widgetboard__empty">No widgets — use “＋ Widget” to add some.</div>
      )}
      {ready &&
        items.map((w) => (
          <Widget key={w.i} id={w.i} type={w.type} colWidth={colWidth} rowHeight={ROW_H} />
        ))}
    </div>
  )
}
