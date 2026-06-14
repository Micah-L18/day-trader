import { create } from 'zustand'
import type { Portfolio } from '@shared/types'

interface PortfolioStore {
  portfolios: Portfolio[]
  activeId: string
  loaded: boolean
  load: () => Promise<void>
  setActive: (id: string) => Promise<void>
  addSim: (name: string, startingCash: number) => Promise<void>
}

const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  portfolios: [],
  activeId: '',
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const s = await window.api.portfolios.get()
    set({ portfolios: s.portfolios, activeId: s.activeId, loaded: true })
  },

  setActive: async (id) => {
    const s = await window.api.portfolios.setActive(id)
    set({ portfolios: s.portfolios, activeId: s.activeId })
  },

  addSim: async (name, startingCash) => {
    const portfolios = [...get().portfolios, { id: uid(), name, kind: 'sim' as const, startingCash }]
    const s = await window.api.portfolios.save({ portfolios, activeId: get().activeId })
    set({ portfolios: s.portfolios, activeId: s.activeId })
  }
}))
