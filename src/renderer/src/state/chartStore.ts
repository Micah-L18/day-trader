import { create } from 'zustand'
import type { Timeframe } from '@shared/types'

interface ChartState {
  interval: Timeframe
  autoScale: boolean
  setInterval: (tf: Timeframe) => void
  setAutoScale: (on: boolean) => void
}

/** Active interval + auto-scale for the main chart (also driven by hotkeys). */
export const useChartStore = create<ChartState>((set) => ({
  interval: '1Min',
  autoScale: true,
  setInterval: (interval) => set({ interval }),
  setAutoScale: (autoScale) => set({ autoScale })
}))
