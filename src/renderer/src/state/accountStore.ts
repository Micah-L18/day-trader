import { create } from 'zustand'
import type { Account, Order, Position } from '@shared/types'

interface AccountState {
  account: Account | null
  positions: Position[]
  orders: Order[]
  setAccount: (a: Account) => void
  setPositions: (p: Position[]) => void
  setOrders: (o: Order[]) => void
  upsertOrder: (o: Order) => void
}

export const useAccountStore = create<AccountState>((set) => ({
  account: null,
  positions: [],
  orders: [],
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setOrders: (orders) => set({ orders }),
  upsertOrder: (o) =>
    set((s) => {
      const idx = s.orders.findIndex((x) => x.id === o.id)
      if (idx === -1) return { orders: [o, ...s.orders] }
      const next = [...s.orders]
      next[idx] = o
      return { orders: next }
    })
}))
