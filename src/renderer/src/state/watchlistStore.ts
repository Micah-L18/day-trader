import { create } from 'zustand'

interface WatchlistState {
  symbols: string[]
  selected: string | null
  setSymbols: (symbols: string[]) => void
  select: (symbol: string) => void
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  symbols: [],
  selected: null,
  setSymbols: (symbols) => set((s) => ({ symbols, selected: s.selected ?? symbols[0] ?? null })),
  select: (selected) => set({ selected })
}))
