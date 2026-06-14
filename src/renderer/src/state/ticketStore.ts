import { create } from 'zustand'
import type { Side } from '@shared/types'

interface TicketState {
  side: Side
  setSide: (s: Side) => void
}

/** Shared so the symbol-header Buy/Sell buttons can drive the order ticket. */
export const useTicketStore = create<TicketState>((set) => ({
  side: 'buy',
  setSide: (side) => set({ side })
}))
