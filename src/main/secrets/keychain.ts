import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AlpacaCredentials } from '@shared/types'

export type CredSlot = 'paper' | 'live'

interface StoredCreds {
  paper?: AlpacaCredentials
  live?: AlpacaCredentials
}

const credsFile = (): string => join(app.getPath('userData'), 'secrets.bin')

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function loadAll(): StoredCreds {
  try {
    const file = credsFile()
    if (!existsSync(file) || !encryptionAvailable()) return {}
    const buf = readFileSync(file)
    if (buf.length === 0) return {}
    const parsed = JSON.parse(safeStorage.decryptString(buf)) as StoredCreds &
      Partial<AlpacaCredentials>
    // Migrate the old flat { keyId, secretKey } format → paper slot.
    if (parsed.keyId && parsed.secretKey && !parsed.paper) {
      return { paper: { keyId: parsed.keyId, secretKey: parsed.secretKey } }
    }
    return { paper: parsed.paper, live: parsed.live }
  } catch (err) {
    console.error('Failed to load credentials:', err)
    return {}
  }
}

function saveAll(creds: StoredCreds): void {
  if (!encryptionAvailable()) {
    // Guardrail: never persist secrets in plaintext.
    throw new Error('OS encryption is unavailable; refusing to store API keys in plaintext.')
  }
  const file = credsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, safeStorage.encryptString(JSON.stringify(creds)), { mode: 0o600 })
}

export function loadCreds(slot: CredSlot = 'paper'): AlpacaCredentials | null {
  const c = loadAll()[slot]
  return c?.keyId && c?.secretKey ? c : null
}

export function saveCreds(slot: CredSlot, creds: AlpacaCredentials): void {
  const all = loadAll()
  all[slot] = creds
  saveAll(all)
}

export function clearCreds(): void {
  try {
    const file = credsFile()
    if (existsSync(file)) rmSync(file)
  } catch (err) {
    console.error('Failed to clear credentials:', err)
  }
}
