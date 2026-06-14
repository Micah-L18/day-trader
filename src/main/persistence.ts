import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_KEYMAP,
  DEFAULT_WATCHLIST,
  type Keymap,
  type LayoutsState,
  type WatchlistsState
} from '@shared/types'

const filePath = (name: string): string => join(app.getPath('userData'), name)

function readJson<T extends object>(name: string, fallback: T): T {
  try {
    const f = filePath(name)
    if (!existsSync(f)) return fallback
    return { ...fallback, ...(JSON.parse(readFileSync(f, 'utf8')) as Partial<T>) }
  } catch {
    return fallback
  }
}

function writeJson(name: string, data: unknown): void {
  const f = filePath(name)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(data, null, 2))
}

export function loadKeymap(): Keymap {
  // Merge over defaults so newly-added actions always have a binding.
  return readJson<Keymap>('keymap.json', { ...DEFAULT_KEYMAP })
}

export function saveKeymap(keymap: Keymap): void {
  writeJson('keymap.json', keymap)
}

const DEFAULT_WATCHLISTS: WatchlistsState = {
  lists: [{ id: 'default', name: 'Watchlist', symbols: [...DEFAULT_WATCHLIST] }],
  activeId: 'default'
}

export function loadWatchlists(): WatchlistsState {
  // Prefer the multi-list file; migrate the old single-list watchlist.json if present.
  const multi = readJson<Partial<WatchlistsState>>('watchlists.json', {})
  if (Array.isArray(multi.lists) && multi.lists.length > 0) {
    return { lists: multi.lists, activeId: multi.activeId ?? multi.lists[0].id }
  }
  const legacy = readJson<{ symbols?: string[] }>('watchlist.json', {})
  if (Array.isArray(legacy.symbols) && legacy.symbols.length > 0) {
    return { lists: [{ id: 'default', name: 'Watchlist', symbols: legacy.symbols }], activeId: 'default' }
  }
  return { lists: DEFAULT_WATCHLISTS.lists.map((l) => ({ ...l })), activeId: 'default' }
}

export function saveWatchlists(state: WatchlistsState): void {
  writeJson('watchlists.json', state)
}

/** All symbols across every list — what the app subscribes to. */
export function allWatchlistSymbols(state: WatchlistsState): string[] {
  return [...new Set(state.lists.flatMap((l) => l.symbols.map((s) => s.toUpperCase())))]
}

const DEFAULT_LAYOUTS: LayoutsState = {
  layouts: [{ id: 'default', name: 'Layout 1', railWidth: 320, interval: '1Min' }],
  activeId: 'default'
}

export function loadLayouts(): LayoutsState {
  const data = readJson<LayoutsState>('layouts.json', DEFAULT_LAYOUTS)
  return data.layouts && data.layouts.length > 0 ? data : DEFAULT_LAYOUTS
}

export function saveLayouts(state: LayoutsState): void {
  writeJson('layouts.json', state)
}

export function isOnboarded(): boolean {
  return readJson<{ onboarded: boolean }>('meta.json', { onboarded: false }).onboarded === true
}

export function setOnboarded(): void {
  writeJson('meta.json', { onboarded: true })
}
