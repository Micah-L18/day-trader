import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProviderKind } from '@shared/types'

export interface PersistedSettings {
  provider: ProviderKind
}

const DEFAULTS: PersistedSettings = { provider: 'sim' }
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): PersistedSettings {
  try {
    const file = settingsFile()
    if (!existsSync(file)) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedSettings>
    return { provider: parsed.provider === 'alpaca' ? 'alpaca' : 'sim' }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: PersistedSettings): void {
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2))
}
