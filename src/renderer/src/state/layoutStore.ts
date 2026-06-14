import { create } from 'zustand'
import type { Layout, LayoutsState } from '@shared/types'
import { useChartStore } from './chartStore'

interface LayoutStoreState extends LayoutsState {
  loaded: boolean
  load: () => Promise<void>
  setActive: (id: string) => void
  add: () => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  updateActive: (patch: Partial<Layout>) => void
}

export function activeLayout(s: LayoutsState): Layout | undefined {
  return s.layouts.find((l) => l.id === s.activeId)
}

// Avoid crypto.randomUUID (not available in a non-secure file:// context).
const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(immediate: boolean): void {
  if (saveTimer) clearTimeout(saveTimer)
  const flush = (): void => {
    const { layouts, activeId } = useLayoutStore.getState()
    void window.api.layouts.save({ layouts, activeId })
  }
  if (immediate) flush()
  else saveTimer = setTimeout(flush, 400)
}

function applyLayout(layout: Layout): void {
  useChartStore.getState().setInterval(layout.interval)
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  layouts: [{ id: 'default', name: 'Layout 1', railWidth: 320, interval: '1Min' }],
  activeId: 'default',
  loaded: false,

  load: async () => {
    const state = await window.api.layouts.get()
    set({ layouts: state.layouts, activeId: state.activeId, loaded: true })
    const active = activeLayout(state)
    if (active) applyLayout(active)
  },

  setActive: (id) => {
    const layout = get().layouts.find((l) => l.id === id)
    if (!layout) return
    set({ activeId: id })
    applyLayout(layout)
    persist(true)
  },

  add: () => {
    const layout: Layout = {
      id: uid(),
      name: `Layout ${get().layouts.length + 1}`,
      railWidth: activeLayout(get())?.railWidth ?? 320,
      interval: useChartStore.getState().interval
    }
    set((s) => ({ layouts: [...s.layouts, layout], activeId: layout.id }))
    persist(true)
  },

  remove: (id) => {
    set((s) => {
      if (s.layouts.length <= 1) return s
      const layouts = s.layouts.filter((l) => l.id !== id)
      const activeId = s.activeId === id ? layouts[0].id : s.activeId
      return { layouts, activeId }
    })
    const active = activeLayout(get())
    if (active) applyLayout(active)
    persist(true)
  },

  rename: (id, name) => {
    set((s) => ({ layouts: s.layouts.map((l) => (l.id === id ? { ...l, name } : l)) }))
    persist(true)
  },

  updateActive: (patch) => {
    set((s) => ({ layouts: s.layouts.map((l) => (l.id === s.activeId ? { ...l, ...patch } : l)) }))
    persist(false)
  }
}))
