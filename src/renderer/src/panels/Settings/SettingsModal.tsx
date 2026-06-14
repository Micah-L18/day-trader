import { useEffect, useState, type ReactElement } from 'react'
import type { ProviderKind, SettingsInfo, TestConnectionResult } from '@shared/types'
import { useSystemStore } from '@renderer/state/systemStore'

export function SettingsModal(): ReactElement | null {
  const open = useSystemStore((s) => s.settingsOpen)
  const close = useSystemStore((s) => s.closeSettings)

  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [provider, setProvider] = useState<ProviderKind>('sim')
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTest(null)
    setKeyId('')
    setSecret('')
    void window.api.settings.get().then((i) => {
      setInfo(i)
      setProvider(i.provider)
    })
  }, [open])

  if (!open) return null

  const creds =
    keyId.trim() && secret.trim()
      ? { keyId: keyId.trim(), secretKey: secret.trim() }
      : undefined

  const canSave =
    provider === 'sim' || info?.hasAlpacaKeys === true || creds !== undefined

  const onTest = async (): Promise<void> => {
    setBusy(true)
    try {
      setTest(await window.api.settings.testConnection(creds))
    } finally {
      setBusy(false)
    }
  }

  const onSave = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.settings.save({ provider, alpaca: creds })
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Settings</h2>
          <button className="modal__close" onClick={close}>
            ✕
          </button>
        </div>

        <div className="modal__section">
          <div className="modal__label">Data provider</div>
          <div className="seg">
            <button
              className={`seg__btn ${provider === 'sim' ? 'seg__btn--on' : ''}`}
              onClick={() => setProvider('sim')}
            >
              Simulated
            </button>
            <button
              className={`seg__btn ${provider === 'alpaca' ? 'seg__btn--on' : ''}`}
              onClick={() => setProvider('alpaca')}
            >
              Alpaca (paper)
            </button>
          </div>
        </div>

        <div className="modal__section">
          <div className="modal__label">Alpaca paper API keys</div>
          {info?.hasAlpacaKeys && (
            <div className="modal__hint">
              Stored key: {info.alpacaKeyIdMasked} — leave blank to keep it.
            </div>
          )}
          <input
            className="field"
            placeholder="API Key ID"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <input
            className="field"
            placeholder="API Secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {info && !info.encryptionAvailable && (
            <div className="modal__warn">
              OS encryption unavailable — keys can’t be stored securely here.
            </div>
          )}
          <div className="modal__hint">
            Free paper keys at alpaca.markets. Stored encrypted in your OS keychain. Paper-only.
          </div>
        </div>

        {test && <div className={`modal__result ${test.ok ? 'ok' : 'err'}`}>{test.message}</div>}

        <div className="modal__actions">
          <button className="btn" onClick={onTest} disabled={busy || !creds}>
            Test connection
          </button>
          <span className="spacer" />
          <button className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={onSave} disabled={busy || !canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
