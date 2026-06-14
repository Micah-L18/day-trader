import { create } from 'zustand'
import type { SymbolList, WatchlistsState } from '@shared/types'

interface WatchlistStore {
  lists: SymbolList[]
  activeId: string
  selected: string | null
  loaded: boolean
  load: () => Promise<void>
  setActive: (id: string) => void
  select: (symbol: string) => void
  addSymbol: (symbol: string) => void
  removeSymbol: (symbol: string) => void
  addList: () => void
  removeList: (id: string) => void
  renameList: (id: string, name: string) => void
}

export function activeSymbols(s: { lists: SymbolList[]; activeId: string }): string[] {
  return s.lists.find((l) => l.id === s.activeId)?.symbols ?? []
}

const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const persist = (s: WatchlistsState): void => {
  void window.api.watchlists.set(s)
}

export const useWatchlistStore = create<WatchlistStore>((set, get) => ({
  lists: [],
  activeId: '',
  selected: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const s = await window.api.watchlists.get()
    set((prev) => ({
      lists: s.lists,
      activeId: s.activeId,
      loaded: true,
      selected: prev.selected ?? activeSymbols(s)[0] ?? null
    }))
  },

  setActive: (activeId) => {
    set({ activeId })
    persist({ lists: get().lists, activeId })
    if (!activeSymbols(get()).includes(get().selected ?? '')) {
      set({ selected: activeSymbols(get())[0] ?? null })
    }
  },

  select: (selected) => set({ selected }),

  addSymbol: (symbol) => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === s.activeId && !l.symbols.includes(sym) ? { ...l, symbols: [...l.symbols, sym] } : l
      )
    }))
    persist({ lists: get().lists, activeId: get().activeId })
    set({ selected: sym })
  },

  removeSymbol: (symbol) => {
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === s.activeId ? { ...l, symbols: l.symbols.filter((x) => x !== symbol) } : l
      )
    }))
    persist({ lists: get().lists, activeId: get().activeId })
    if (get().selected === symbol) set({ selected: activeSymbols(get())[0] ?? null })
  },

  addList: () => {
    const list: SymbolList = { id: uid(), name: `List ${get().lists.length + 1}`, symbols: [] }
    set((s) => ({ lists: [...s.lists, list], activeId: list.id }))
    persist({ lists: get().lists, activeId: get().activeId })
  },

  removeList: (id) => {
    set((s) => {
      if (s.lists.length <= 1) return s
      const lists = s.lists.filter((l) => l.id !== id)
      return { lists, activeId: s.activeId === id ? lists[0].id : s.activeId }
    })
    persist({ lists: get().lists, activeId: get().activeId })
    set({ selected: activeSymbols(get())[0] ?? null })
  },

  renameList: (id, name) => {
    set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)) }))
    persist({ lists: get().lists, activeId: get().activeId })
  }
}))
