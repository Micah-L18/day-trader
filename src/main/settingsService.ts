import type { AlpacaCredentials, SettingsInfo, TestConnectionResult } from '@shared/types'
import { loadSettings } from './settings'
import { encryptionAvailable, loadCreds } from './secrets/keychain'
import { AlpacaRest } from './providers/alpaca/rest'

const maskKey = (k: string): string => (k.length <= 6 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-2)}`)

export function getSettingsInfo(): SettingsInfo {
  const creds = loadCreds('paper')
  return {
    provider: loadSettings().provider,
    hasAlpacaKeys: creds != null,
    alpacaKeyIdMasked: creds ? maskKey(creds.keyId) : null,
    encryptionAvailable: encryptionAvailable()
  }
}

/** Probe Alpaca with the given (or stored) creds by fetching the account. */
export async function testConnection(
  creds: AlpacaCredentials | null
): Promise<TestConnectionResult> {
  if (!creds?.keyId || !creds?.secretKey) {
    return { ok: false, message: 'Enter both an API key ID and secret.' }
  }
  try {
    const account = await new AlpacaRest(creds).getAccount()
    return { ok: true, message: `Connected — paper equity $${account.equity.toFixed(2)}.` }
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? String(err) }
  }
}
