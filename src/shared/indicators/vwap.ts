interface OHLCV {
  high: number
  low: number
  close: number
  volume: number
}

/** Cumulative volume-weighted average price over the supplied bars. */
export function vwap(bars: OHLCV[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  let pv = 0
  let vol = 0
  for (let i = 0; i < bars.length; i++) {
    const typical = (bars[i].high + bars[i].low + bars[i].close) / 3
    pv += typical * bars[i].volume
    vol += bars[i].volume
    out[i] = vol > 0 ? pv / vol : null
  }
  return out
}
