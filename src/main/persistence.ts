import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_KEYMAP, DEFAULT_WATCHLIST, type Keymap, type LayoutsState } from '@shared/types'

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

export function loadWatchlist(): string[] {
  const data = readJson<{ symbols: string[] }>('watchlist.json', { symbols: [...DEFAULT_WATCHLIST] })
  return Array.isArray(data.symbols) && data.symbols.length > 0
    ? data.symbols.map((s) => s.toUpperCase())
    : [...DEFAULT_WATCHLIST]
}

export function saveWatchlist(symbols: string[]): void {
  writeJson('watchlist.json', { symbols })
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
