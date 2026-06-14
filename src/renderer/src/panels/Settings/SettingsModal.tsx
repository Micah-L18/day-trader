import { useEffect, useState, type ReactElement } from 'react'
import {
  RISK_LIMIT_ITEMS,
  type HotkeyAction,
  type Keymap,
  type RiskLimits,
  type SettingsInfo,
  type TestConnectionResult
} from '@shared/types'
import { useSystemStore } from '@renderer/state/systemStore'
import { useKeymapStore } from '@renderer/state/keymapStore'
import { useRiskStore } from '@renderer/state/riskStore'
import { HOTKEY_ITEMS, eventToBinding, prettyBinding } from '@renderer/lib/hotkeys'

type Tab = 'general' | 'risk' | 'hotkeys'

export function SettingsModal(): ReactElement | null {
  const open = useSystemStore((s) => s.settingsOpen)
  const close = useSystemStore((s) => s.closeSettings)
  const keymap = useKeymapStore((s) => s.keymap)
  const setKeymap = useKeymapStore((s) => s.setKeymap)
  const riskLimits = useRiskStore((s) => s.risk.limits)
  const setRisk = useRiskStore((s) => s.setRisk)

  const [tab, setTab] = useState<Tab>('general')
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null)
  const [limits, setLimits] = useState<RiskLimits>(riskLimits)

  useEffect(() => {
    if (!open) return
    setTest(null)
    setKeyId('')
    setSecret('')
    setLimits(useRiskStore.getState().risk.limits)
    void window.api.settings.get().then(setInfo)
  }, [open])

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setCapturing(null)
      const binding = eventToBinding(e)
      if (!binding) return
      const next: Keymap = { ...keymap }
      for (const a of Object.keys(next) as HotkeyAction[]) if (next[a] === binding) next[a] = ''
      next[capturing] = binding
      void window.api.hotkeys.save(next).then(setKeymap)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, keymap, setKeymap])

  if (!open) return null

  const creds =
    keyId.trim() && secret.trim() ? { keyId: keyId.trim(), secretKey: secret.trim() } : undefined

  const onTest = async (): Promise<void> => {
    setBusy(true)
    try {
      setTest(await window.api.settings.testConnection(creds))
    } finally {
      setBusy(false)
    }
  }
  const onSaveKeys = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.settings.save({ provider: info?.provider ?? 'sim', alpaca: creds })
      close()
    } finally {
      setBusy(false)
    }
  }
  const onApplyRisk = async (): Promise<void> => {
    setBusy(true)
    try {
      setRisk(await window.api.risk.setLimits(limits))
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

        <div className="settabs">
          {(['general', 'risk', 'hotkeys'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`settab ${tab === t ? 'settab--on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'general' ? 'General' : t === 'risk' ? 'Risk' : 'Hotkeys'}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="modal__section">
              <div className="modal__label">Alpaca paper API keys</div>
              <div className="modal__hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Switch between Simulated / Alpaca accounts from the portfolio selector in the top bar.
              </div>
              {info?.hasAlpacaKeys && (
                <div className="modal__hint">Stored key: {info.alpacaKeyIdMasked} — leave blank to keep it.</div>
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
                <div className="modal__warn">OS encryption unavailable — keys can’t be stored securely here.</div>
              )}
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
              <button className="btn btn--primary" onClick={onSaveKeys} disabled={busy || !creds}>
                Save keys
              </button>
            </div>
          </>
        )}

        {tab === 'risk' && (
          <>
            <div className="modal__section">
              <div className="modal__label">SafetyGate limits</div>
              <div className="keymap">
                {RISK_LIMIT_ITEMS.map(({ key, label }) => (
                  <div className="keymap__row" key={key}>
                    <span>{label}</span>
                    <input
                      className="field field--sm"
                      type="number"
                      value={limits[key]}
                      onChange={(e) => setLimits((l) => ({ ...l, [key]: Number(e.target.value) }))}
                    />
                  </div>
                ))}
              </div>
              <div className="modal__hint">Every order is checked against these before it reaches the broker.</div>
            </div>
            <div className="modal__actions">
              <span className="spacer" />
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={onApplyRisk} disabled={busy}>
                Apply
              </button>
            </div>
          </>
        )}

        {tab === 'hotkeys' && (
          <>
            <div className="modal__section">
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
                Click a shortcut, then press the new combo (Esc cancels). Global: ⌘⇧⌫ flattens from anywhere.
              </div>
            </div>
            <div className="modal__actions">
              <span className="spacer" />
              <button className="btn btn--primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
