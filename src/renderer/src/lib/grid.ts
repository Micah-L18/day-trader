import { GRID_COLS, type WidgetItem } from '@shared/types'

/** Column grid geometry. Widget x/w are columns; y/h are rows. */
export const COLS = GRID_COLS
export const ROW_H = 28
export const MARGIN = 8
export const MIN_W = 2
export const MIN_H = 3

export const clampNum = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi)

/** Do two grid rects overlap? (Touching edges do not count.) */
export function collides(a: WidgetItem, b: WidgetItem): boolean {
  return (
    a.i !== b.i &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

/**
 * Resolve overlaps while keeping `fixedId` exactly where it was placed. Other
 * widgets are processed top-to-bottom and pushed straight down past whatever
 * they collide with — so dragging onto a widget shoves it out of the way, but
 * widgets that don't collide keep their spot (gaps are allowed, no upward
 * compaction). Unchanged widgets keep their object identity to avoid re-renders.
 */
function avoidCollisions(items: WidgetItem[], fixedId: string): WidgetItem[] {
  const fixed = items.find((i) => i.i === fixedId)
  if (!fixed) return items

  const others = items
    .filter((i) => i.i !== fixedId)
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const placed: WidgetItem[] = [fixed]
  const moved = new Map<string, WidgetItem>()

  for (const it of others) {
    let cur = it
    // Drop straight down until this widget clears everything already placed.
    while (placed.some((p) => collides(p, cur))) {
      const bottom = Math.max(
        ...placed.filter((p) => collides(p, cur)).map((p) => p.y + p.h)
      )
      cur = { ...cur, y: bottom }
    }
    placed.push(cur)
    if (cur !== it) moved.set(it.i, cur)
  }

  return moved.size === 0 ? items : items.map((it) => moved.get(it.i) ?? it)
}

/**
 * Place widget `id` at the snapped target rect (clamped to the grid) and resolve
 * any overlaps it causes. `base` is the layout snapshot at gesture start, so the
 * result is recomputed fresh each move (dragging away lets pushed widgets settle
 * back rather than plowing them permanently).
 */
export function moveWidget(
  base: WidgetItem[],
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
): WidgetItem[] {
  const cw = clampNum(Math.round(w), MIN_W, COLS)
  const cx = clampNum(Math.round(x), 0, COLS - cw)
  const cy = Math.max(0, Math.round(y))
  const ch = Math.max(MIN_H, Math.round(h))
  const next = base.map((it) => (it.i === id ? { ...it, x: cx, y: cy, w: cw, h: ch } : it))
  return avoidCollisions(next, id)
}

/** A free spot for a new widget: full-width-agnostic, dropped below everything. */
export function nextSpot(items: WidgetItem[]): { x: number; y: number } {
  const y = items.length ? Math.max(...items.map((i) => i.y + i.h)) : 0
  return { x: 0, y }
}
