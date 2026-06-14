import { useEffect, useState, type ReactElement } from 'react'
import { LIVE_CONFIRM_PHRASE } from '@shared/types'
import { useSystemStore } from '@renderer/state/systemStore'
import { useLiveStore } from '@renderer/state/liveStore'

/** The third live-trading gate: a typed on-screen confirmation (+ live keys). */
export function LiveArmModal(): ReactElement | null {
  const open = useSystemStore((s) => s.liveArmOpen)
  const close = useSystemStore((s) => s.closeLiveArm)
  const live = useLiveStore((s) => s.live)
  const setLive = useLiveStore((s) => s.setLive)

  const [confirm, setConfirm] = useState('')
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setConfirm('')
      setKeyId('')
      setSecret('')
      setError(null)
    }
  }, [open])

  if (!open) return null

  const liveCreds =
    keyId.trim() && secret.trim() ? { keyId: keyId.trim(), secretKey: secret.trim() } : undefined
  const canArm = confirm === LIVE_CONFIRM_PHRASE && (live.hasLiveKeys || liveCreds !== undefined) && !busy

  const arm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.live.arm({ confirm, live: liveCreds })
      if (res.ok) {
        setLive(await window.api.live.getState())
        close()
      } else {
        setError(res.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>⚠ Arm live trading</h2>
          <button className="modal__close" onClick={close}>
            ✕
          </button>
        </div>

        <div className="modal__section">
          <div className="live-warn">
            This routes orders to your <b>real Alpaca account with real money</b>. Orders still pass
            the SafetyGate, but fills are <b>real and irreversible</b>.
          </div>
        </div>

        {!live.hasLiveKeys && (
          <div className="modal__section">
            <div className="modal__label">Live Alpaca API keys</div>
            <input
              className="field"
              placeholder="Live API Key ID"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <input
              className="field"
              placeholder="Live API Secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="modal__hint">
              Live keys differ from paper keys (from your Alpaca live dashboard). Stored encrypted.
            </div>
          </div>
        )}

        <div className="modal__section">
          <div className="modal__label">
            Type <code>{LIVE_CONFIRM_PHRASE}</code> to confirm
          </div>
          <input
            className="field"
            placeholder={LIVE_CONFIRM_PHRASE}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && <div className="modal__result err">{error}</div>}

        <div className="modal__actions">
          <span className="spacer" />
          <button className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--danger" onClick={arm} disabled={!canArm}>
            Arm live trading
          </button>
        </div>
      </div>
    </div>
  )
}
