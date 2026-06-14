import { create } from 'zustand'
import type { Side } from '@shared/types'

export interface TicketPos {
  x: number
  y: number
}

interface TicketState {
  open: boolean
  side: Side
  /** Last dragged position; null until first placed. */
  pos: TicketPos | null
  openTicket: (side: Side) => void
  close: () => void
  setSide: (s: Side) => void
  setPos: (p: TicketPos) => void
}

/** Drives the floating, draggable order ticket. Buy/Sell buttons open it. */
export const useTicketStore = create<TicketState>((set) => ({
  open: false,
  side: 'buy',
  pos: null,
  openTicket: (side) => set({ open: true, side }),
  close: () => set({ open: false }),
  setSide: (side) => set({ side }),
  setPos: (pos) => set({ pos })
}))
