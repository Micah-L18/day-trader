import { create } from 'zustand'

interface DrawingStore {
  bySymbol: Record<string, number[]>
  loaded: boolean
  load: () => Promise<void>
  addLine: (symbol: string, price: number) => void
  clear: (symbol: string) => void
}

const persist = (map: Record<string, number[]>): void => {
  void window.api.drawings.set(map)
}

/** Horizontal lines drawn on charts, keyed by symbol, persisted to disk. */
export const useDrawingStore = create<DrawingStore>((set, get) => ({
  bySymbol: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return
    set({ bySymbol: await window.api.drawings.get(), loaded: true })
  },

  addLine: (symbol, price) => {
    const rounded = Math.round(price * 100) / 100
    set((s) => ({
      bySymbol: { ...s.bySymbol, [symbol]: [...(s.bySymbol[symbol] ?? []), rounded] }
    }))
    persist(get().bySymbol)
  },

  clear: (symbol) => {
    set((s) => ({ bySymbol: { ...s.bySymbol, [symbol]: [] } }))
    persist(get().bySymbol)
  }
}))
