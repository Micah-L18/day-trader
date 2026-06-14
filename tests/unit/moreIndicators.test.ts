import { describe, expect, it } from 'vitest'
import { sma } from '../../src/shared/indicators/sma'
import { rsi } from '../../src/shared/indicators/rsi'
import { vwap } from '../../src/shared/indicators/vwap'
import { bbands } from '../../src/shared/indicators/bbands'

describe('sma', () => {
  it('averages over the window with leading nulls', () => {
    expect(sma([2, 4, 6, 8], 2)).toEqual([null, 3, 5, 7])
  })
})

describe('rsi', () => {
  it('approaches 100 on a monotonically rising series', () => {
    const out = rsi(
      Array.from({ length: 30 }, (_, i) => i + 1),
      14
    )
    expect(out.at(-1)).toBeCloseTo(100, 5)
  })
  it('stays within 0..100', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i / 3) * 10)
    for (const v of rsi(vals)) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('vwap', () => {
  it('equals constant price under uniform volume', () => {
    const bars = Array.from({ length: 5 }, () => ({ high: 10, low: 10, close: 10, volume: 100 }))
    expect(vwap(bars).at(-1)).toBe(10)
  })
})

describe('bbands', () => {
  it('brackets the middle band', () => {
    const vals = Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i))
    const bb = bbands(vals, 20, 2).at(-1)
    expect(bb?.middle).not.toBeNull()
    expect(bb!.upper!).toBeGreaterThan(bb!.middle!)
    expect(bb!.lower!).toBeLessThan(bb!.middle!)
  })
})
