import { useEffect, useState, type ReactElement } from 'react'
import type { HotkeyAction, Keymap, ProviderKind, SettingsInfo, TestConnectionResult } from '@shared/types'
import { useSystemStore } from '@renderer/state/systemStore'
import { useKeymapStore } from '@renderer/state/keymapStore'
import { HOTKEY_ITEMS, eventToBinding, prettyBinding } from '@renderer/lib/hotkeys'

export function SettingsModal(): ReactElement | null {
  const open = useSystemStore((s) => s.settingsOpen)
  const close = useSystemStore((s) => s.closeSettings)

  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [provider, setProvider] = useState<ProviderKind>('sim')
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const [busy, setBusy] = useState(false)

  const keymap = useKeymapStore((s) => s.keymap)
  const setKeymap = useKeymapStore((s) => s.setKeymap)
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null)

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

  // While rebinding, capture the next key combo (capture phase, so it pre-empts
  // the global hotkey handler).
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const binding = eventToBinding(e)
      if (!binding) return
      const next: Keymap = { ...keymap }
      for (const a of Object.keys(next) as HotkeyAction[]) {
        if (next[a] === binding) next[a] = '' // a binding maps to one action
      }
      next[capturing] = binding
      void window.api.hotkeys.save(next).then(setKeymap)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, keymap, setKeymap])

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

        <div className="modal__section">
          <div className="modal__label">Hotkeys</div>
          <div className="keymap">
            {HOTKEY_ITEMS.map(({ action, label }) => (
              <div className="keymap__row" key={action}>
                <span>{label}</span>
                <button
                  className={`keymap__key ${capturing === action ? 'keymap__key--capturing' : ''}`}
                  onClick={() => setCapturing(action)}
                >
                  {capturing === action ? 'press keys…' : prettyBinding(keymap[action])}
                </button>
              </div>
            ))}
          </div>
          <div className="modal__hint">
            Click a shortcut, then press the new combo (Esc cancels). Shortcuts pause while typing in
            a field. Global: ⌘⇧⌫ flattens everything from anywhere.
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
