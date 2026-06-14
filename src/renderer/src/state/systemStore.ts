import { create } from 'zustand'
import type { ConnectionStatus } from '@shared/types'

interface SystemState {
  status: ConnectionStatus
  settingsOpen: boolean
  liveArmOpen: boolean
  setStatus: (s: ConnectionStatus) => void
  openSettings: () => void
  closeSettings: () => void
  openLiveArm: () => void
  closeLiveArm: () => void
}

export const useSystemStore = create<SystemState>((set) => ({
  status: { provider: 'sim', market: 'idle', trading: 'idle' },
  settingsOpen: false,
  liveArmOpen: false,
  setStatus: (status) => set({ status }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openLiveArm: () => set({ liveArmOpen: true }),
  closeLiveArm: () => set({ liveArmOpen: false })
}))
