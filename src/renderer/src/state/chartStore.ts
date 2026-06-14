import { create } from 'zustand'
import type { Timeframe } from '@shared/types'

interface ChartState {
  interval: Timeframe
  setInterval: (tf: Timeframe) => void
}

/** Active interval for the main chart (also driven by the cycle-interval hotkey). */
export const useChartStore = create<ChartState>((set) => ({
  interval: '1Min',
  setInterval: (interval) => set({ interval })
}))
