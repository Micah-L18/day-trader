import { useEffect } from 'react'
import { CHART_INTERVALS, type HotkeyAction, type OrderStatus } from '@shared/types'
import { useKeymapStore } from './keymapStore'
import { useTicketStore } from './ticketStore'
import { activeSymbols, useWatchlistStore } from './watchlistStore'
import { useRiskStore } from './riskStore'
import { useAccountStore } from './accountStore'
import { useSystemStore } from './systemStore'
import { useChartStore } from './chartStore'
import { eventToBinding, findAction } from '@renderer/lib/hotkeys'

const OPEN: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'new',
  'accepted',
  'partially_filled',
  'pending'
])

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

function cycleSymbol(dir: 1 | -1): void {
  const st = useWatchlistStore.getState()
  const symbols = activeSymbols(st)
  if (symbols.length === 0) return
  const idx = st.selected ? symbols.indexOf(st.selected) : -1
  st.select(symbols[(idx + dir + symbols.length) % symbols.length])
}

function cycleInterval(): void {
  const { interval, setInterval } = useChartStore.getState()
  const idx = CHART_INTERVALS.findIndex((c) => c.tf === interval)
  setInterval(CHART_INTERVALS[(idx + 1) % CHART_INTERVALS.length].tf)
}

async function run(action: HotkeyAction): Promise<void> {
  switch (action) {
    case 'openBuy':
      useTicketStore.getState().openTicket('buy')
      break
    case 'openSell':
      useTicketStore.getState().openTicket('sell')
      break
    case 'flatten':
      await window.api.risk.flattenAll()
      break
    case 'killSwitch': {
      const cur = useRiskStore.getState().risk.killSwitch
      useRiskStore.getState().setRisk(await window.api.risk.setKillSwitch(!cur))
      break
    }
    case 'cancelAll': {
      const open = useAccountStore.getState().orders.filter((o) => OPEN.has(o.status))
      await Promise.all(open.map((o) => window.api.orders.cancel(o.id)))
      break
    }
    case 'nextSymbol':
      cycleSymbol(1)
      break
    case 'prevSymbol':
      cycleSymbol(-1)
      break
    case 'cycleInterval':
      cycleInterval()
      break
    case 'focusSearch':
      document.getElementById('symbol-search-input')?.focus()
      break
    case 'popoutChart': {
      const sel = useWatchlistStore.getState().selected
      void window.api.windows.open('chart', sel ? { symbol: sel } : {})
      break
    }
    case 'openSettings':
      useSystemStore.getState().openSettings()
      break
  }
}

/** Global in-app keyboard handler. Mount once at the app root. */
export function useHotkeys(): void {
  const keymap = useKeymapStore((s) => s.keymap)

  useEffect(() => {
    void window.api.hotkeys.get().then(useKeymapStore.getState().setKeymap)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditable(e.target)) return
      const action = findAction(keymap, eventToBinding(e))
      if (!action) return
      e.preventDefault()
      void run(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keymap])
}
