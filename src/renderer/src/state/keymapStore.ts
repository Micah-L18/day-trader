import { create } from 'zustand'
import { DEFAULT_KEYMAP, type Keymap } from '@shared/types'

interface KeymapState {
  keymap: Keymap
  setKeymap: (k: Keymap) => void
}

export const useKeymapStore = create<KeymapState>((set) => ({
  keymap: { ...DEFAULT_KEYMAP },
  setKeymap: (keymap) => set({ keymap })
}))
