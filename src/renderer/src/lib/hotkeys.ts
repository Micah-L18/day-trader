import type { HotkeyAction, Keymap } from '@shared/types'

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt'])

/** Canonical binding string for a keyboard event: mod+alt+shift+key (lowercase).
 * Returns '' for a bare modifier press. */
export function eventToBinding(e: KeyboardEvent): string {
  let key = e.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return ''
  if (key === ' ') key = 'space'

  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

export function findAction(keymap: Keymap, binding: string): HotkeyAction | null {
  if (!binding) return null
  for (const action of Object.keys(keymap) as HotkeyAction[]) {
    if (keymap[action] === binding) return action
  }
  return null
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

/** Human-readable binding, e.g. "shift+f" → "⇧F". */
export function prettyBinding(binding: string): string {
  if (!binding) return '—'
  const mac = isMac()
  const sym: Record<string, string> = {
    mod: mac ? '⌘' : 'Ctrl',
    shift: mac ? '⇧' : 'Shift',
    alt: mac ? '⌥' : 'Alt',
    space: 'Space',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→'
  }
  return binding
    .split('+')
    .map((p) => sym[p] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join(mac ? '' : '+')
}

export const HOTKEY_ITEMS: { action: HotkeyAction; label: string }[] = [
  { action: 'openBuy', label: 'Open Buy ticket' },
  { action: 'openSell', label: 'Open Sell ticket' },
  { action: 'flatten', label: 'Flatten all (panic)' },
  { action: 'killSwitch', label: 'Toggle kill switch' },
  { action: 'cancelAll', label: 'Cancel all open orders' },
  { action: 'nextSymbol', label: 'Next symbol' },
  { action: 'prevSymbol', label: 'Previous symbol' },
  { action: 'cycleInterval', label: 'Cycle chart interval' },
  { action: 'focusSearch', label: 'Focus symbol search' },
  { action: 'popoutChart', label: 'Pop out chart' },
  { action: 'openSettings', label: 'Open settings' }
]
