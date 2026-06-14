export interface BBand {
  upper: number | null
  middle: number | null
  lower: number | null
}

/** Bollinger Bands: SMA(period) ± mult · population stddev. */
export function bbands(values: number[], period = 20, mult = 2): BBand[] {
  const out: BBand[] = values.map(() => ({ upper: null, middle: null, lower: null }))
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    const mean = sum / period
    let variance = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean
      variance += d * d
    }
    const sd = Math.sqrt(variance / period)
    out[i] = { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd }
  }
  return out
}
