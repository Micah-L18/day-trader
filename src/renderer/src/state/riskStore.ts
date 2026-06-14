import { create } from 'zustand'
import type { RiskState } from '@shared/types'

const EMPTY: RiskState = {
  killSwitch: false,
  dailyHalt: false,
  startEquity: null,
  equity: null,
  dailyPnl: 0,
  limits: {
    maxOrderNotional: 0,
    maxPositionShares: 0,
    maxPositionNotional: 0,
    maxGrossExposure: 0,
    dailyLossLimit: 0,
    maxOrdersPerMinute: 0
  }
}

interface RiskStoreState {
  risk: RiskState
  setRisk: (r: RiskState) => void
}

export const useRiskStore = create<RiskStoreState>((set) => ({
  risk: EMPTY,
  setRisk: (risk) => set({ risk })
}))
