import { ema } from './ema'

export interface MacdPoint {
  macd: number | null
  signal: number | null
  histogram: number | null
}

/**
 * MACD(fast, slow, signal). macd = EMA(fast) − EMA(slow); signal = EMA(macd,
 * signalPeriod); histogram = macd − signal. Output is aligned to the input
 * length with `null` where a value isn't defined yet.
 */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MacdPoint[] {
  const emaFast = ema(values, fast)
  const emaSlow = ema(values, slow)

  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i]
    const s = emaSlow[i]
    return f != null && s != null ? f - s : null
  })

  const out: MacdPoint[] = values.map(() => ({ macd: null, signal: null, histogram: null }))

  const firstIdx = macdLine.findIndex((v) => v != null)
  if (firstIdx === -1) return out

  // EMA of the contiguous defined portion of the MACD line.
  const compact = macdLine.slice(firstIdx).map((v) => v as number)
  const signalCompact = ema(compact, signalPeriod)

  for (let i = 0; i < values.length; i++) {
    const m = macdLine[i]
    const s = i >= firstIdx ? signalCompact[i - firstIdx] : null
    out[i] = {
      macd: m,
      signal: s,
      histogram: m != null && s != null ? m - s : null
    }
  }
  return out
}
