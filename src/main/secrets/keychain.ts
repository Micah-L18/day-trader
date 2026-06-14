import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AlpacaCredentials } from '@shared/types'

const credsFile = (): string => join(app.getPath('userData'), 'secrets.bin')

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function loadCreds(): AlpacaCredentials | null {
  try {
    const file = credsFile()
    if (!existsSync(file) || !encryptionAvailable()) return null
    const buf = readFileSync(file)
    if (buf.length === 0) return null
    const parsed = JSON.parse(safeStorage.decryptString(buf)) as Partial<AlpacaCredentials>
    if (parsed.keyId && parsed.secretKey) {
      return { keyId: parsed.keyId, secretKey: parsed.secretKey }
    }
    return null
  } catch (err) {
    console.error('Failed to load credentials:', err)
    return null
  }
}

export function saveCreds(creds: AlpacaCredentials): void {
  if (!encryptionAvailable()) {
    // Guardrail: never persist secrets in plaintext.
    throw new Error('OS encryption is unavailable; refusing to store API keys in plaintext.')
  }
  const file = credsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, safeStorage.encryptString(JSON.stringify(creds)), { mode: 0o600 })
}

export function clearCreds(): void {
  try {
    const file = credsFile()
    if (existsSync(file)) rmSync(file)
  } catch (err) {
    console.error('Failed to clear credentials:', err)
  }
}
