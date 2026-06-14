import { useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { activeLayout, useLayoutStore } from '@renderer/state/layoutStore'

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** Draggable divider between the left rail and the chart; persists rail width. */
export function RailResizer(): ReactElement {
  const railWidth = useLayoutStore((s) => activeLayout(s)?.railWidth ?? 320)
  const updateActive = useLayoutStore((s) => s.updateActive)
  const drag = useRef<{ x: number; w: number } | null>(null)

  const down = (e: ReactPointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: railWidth }
  }
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d) return
    updateActive({ railWidth: clamp(d.w + (e.clientX - d.x), 240, 640) })
  }
  const up = (e: ReactPointerEvent): void => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return <div className="resizer" onPointerDown={down} onPointerMove={move} onPointerUp={up} />
}
