import { describe, expect, it } from 'vitest'
import { ema } from '../../src/shared/indicators/ema'
import { macd } from '../../src/shared/indicators/macd'

describe('ema', () => {
  it('returns the input for period 1 (k = 1)', () => {
    expect(ema([2, 4, 6], 1)).toEqual([2, 4, 6])
  })

  it('seeds with SMA and leaves nulls before the period', () => {
    // period 3, k = 0.5: seed = mean(1,2,3) = 2; then 4*.5+2*.5=3; 5*.5+3*.5=4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('returns all nulls when there is not enough data', () => {
    expect(ema([1, 2], 5)).toEqual([null, null])
  })
})

describe('macd', () => {
  it('aligns to input length with leading nulls', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i)
    const out = macd(values)
    expect(out).toHaveLength(60)
    expect(out[0]).toEqual({ macd: null, signal: null, histogram: null })
    expect(out.at(-1)?.macd).not.toBeNull()
    expect(out.at(-1)?.signal).not.toBeNull()
  })

  it('is positive on a steadily rising series (fast EMA above slow)', () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + i)
    const last = macd(values).at(-1)
    expect(last?.macd).toBeGreaterThan(0)
  })

  it('keeps histogram = macd - signal where both defined', () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    for (const p of macd(values)) {
      if (p.macd != null && p.signal != null) {
        expect(p.histogram).toBeCloseTo(p.macd - p.signal, 9)
      }
    }
  })
})
