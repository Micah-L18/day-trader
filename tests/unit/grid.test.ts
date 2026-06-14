import { describe, expect, it } from 'vitest'
import type { WidgetItem } from '../../src/shared/types'
import { COLS, collides, moveWidget, nextSpot } from '../../src/renderer/src/lib/grid'

const w = (i: string, x: number, y: number, ww: number, h: number): WidgetItem => ({
  i,
  type: 'chart',
  x,
  y,
  w: ww,
  h
})

/** No two widgets in the layout overlap. */
const noOverlaps = (items: WidgetItem[]): boolean =>
  items.every((a) => items.every((b) => a.i === b.i || !collides(a, b)))

describe('collides', () => {
  it('detects overlapping rects', () => {
    expect(collides(w('a', 0, 0, 2, 2), w('b', 1, 1, 2, 2))).toBe(true)
  })
  it('treats touching edges as non-colliding', () => {
    expect(collides(w('a', 0, 0, 2, 2), w('b', 2, 0, 2, 2))).toBe(false)
    expect(collides(w('a', 0, 0, 2, 2), w('b', 0, 2, 2, 2))).toBe(false)
  })
  it('never collides with itself', () => {
    const a = w('a', 0, 0, 2, 2)
    expect(collides(a, { ...a })).toBe(false)
  })
})

describe('moveWidget', () => {
  it('clamps the target to the grid bounds', () => {
    const base = [w('chart', 0, 0, 4, 4)]
    const out = moveWidget(base, 'chart', 99, -10, 4, 4)
    const c = out.find((i) => i.i === 'chart')!
    expect(c.x).toBe(COLS - 4)
    expect(c.y).toBe(0)
  })

  it('pushes a collided widget straight down', () => {
    const base = [w('a', 0, 0, 6, 4), w('b', 0, 4, 6, 4)]
    // Drag A down so it overlaps B.
    const out = moveWidget(base, 'a', 0, 3, 6, 4)
    const a = out.find((i) => i.i === 'a')!
    const b = out.find((i) => i.i === 'b')!
    expect(a.y).toBe(3)
    expect(b.y).toBe(a.y + a.h) // shoved just below A
    expect(noOverlaps(out)).toBe(true)
  })

  it('leaves non-colliding widgets untouched (same identity)', () => {
    const base = [w('a', 0, 0, 3, 4), w('b', 6, 0, 3, 4)]
    const out = moveWidget(base, 'a', 0, 1, 3, 4)
    expect(out.find((i) => i.i === 'b')).toBe(base[1]) // referential identity preserved
  })

  it('keeps the layout overlap-free even with cascading pushes', () => {
    const base = [
      w('a', 0, 0, 4, 4),
      w('b', 0, 4, 4, 4),
      w('c', 0, 8, 4, 4)
    ]
    // Drop A right on top of B; B must move down past C without overlap.
    const out = moveWidget(base, 'a', 0, 4, 4, 6)
    expect(noOverlaps(out)).toBe(true)
  })
})

describe('nextSpot', () => {
  it('drops below everything', () => {
    expect(nextSpot([w('a', 0, 0, 3, 4), w('b', 3, 2, 3, 5)])).toEqual({ x: 0, y: 7 })
  })
  it('starts at the origin when empty', () => {
    expect(nextSpot([])).toEqual({ x: 0, y: 0 })
  })
})
