import { create } from 'zustand'
import type { LiveState } from '@shared/types'

interface LiveStoreState {
  live: LiveState
  setLive: (s: LiveState) => void
}

export const useLiveStore = create<LiveStoreState>((set) => ({
  live: { capable: false, armed: false, hasLiveKeys: false },
  setLive: (live) => set({ live })
}))
