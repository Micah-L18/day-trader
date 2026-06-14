import { create } from 'zustand'
import {
  CHART_RANGES,
  DEFAULT_INDICATORS,
  type IndicatorConfig,
  type RangeKey,
  type Timeframe
} from '@shared/types'

interface ChartState {
  interval: Timeframe
  range: RangeKey
  autoScale: boolean
  drawMode: boolean
  indicators: IndicatorConfig
  setInterval: (tf: Timeframe) => void
  setRange: (r: RangeKey) => void
  setAutoScale: (on: boolean) => void
  setDrawMode: (on: boolean) => void
  toggleIndicator: (key: keyof IndicatorConfig) => void
}

/** Main-chart controls (interval, history range, auto-scale, indicators). */
export const useChartStore = create<ChartState>((set) => ({
  interval: '5Min',
  range: '1D',
  autoScale: true,
  drawMode: false,
  indicators: { ...DEFAULT_INDICATORS },
  setInterval: (interval) => set({ interval }),
  setRange: (range) =>
    set({ range, interval: CHART_RANGES.find((r) => r.key === range)?.interval ?? '5Min' }),
  setAutoScale: (autoScale) => set({ autoScale }),
  setDrawMode: (drawMode) => set({ drawMode }),
  toggleIndicator: (key) =>
    set((s) => ({ indicators: { ...s.indicators, [key]: !s.indicators[key] } }))
}))
