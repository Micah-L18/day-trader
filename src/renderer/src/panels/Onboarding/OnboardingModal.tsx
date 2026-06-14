import { useEffect, useState, type ReactElement } from 'react'
import { useSystemStore } from '@renderer/state/systemStore'

/** Shown once, on first launch. Establishes the paper-first model up front. */
export function OnboardingModal(): ReactElement | null {
  const [show, setShow] = useState(false)
  const openSettings = useSystemStore((s) => s.openSettings)

  useEffect(() => {
    void window.api.onboarding.get().then((done) => setShow(!done))
  }, [])

  if (!show) return null

  const finish = async (thenSettings: boolean): Promise<void> => {
    await window.api.onboarding.complete()
    setShow(false)
    if (thenSettings) openSettings()
  }

  return (
    <div className="modal-backdrop">
      <div className="modal onboarding">
        <div className="modal__head">
          <h2>◆ Welcome to Daytrader Terminal</h2>
        </div>
        <div className="modal__section">
          <p>
            A Legend-style trading terminal. It runs in <b>paper / simulated</b> mode by default —
            no real money, no account required.
          </p>
          <ul className="onboard-list">
            <li>📈 Live charts (candles · volume · MACD), watchlists, hotkeys, pop-out windows.</li>
            <li>🧪 The <b>Simulated</b> feed is running now — fully interactive with zero setup.</li>
            <li>🔑 Add free <b>Alpaca paper</b> keys anytime for real market data.</li>
            <li>🛡️ Every order flows through the SafetyGate. Live trading stays disabled.</li>
          </ul>
        </div>
        <div className="modal__actions">
          <span className="spacer" />
          <button className="btn" onClick={() => finish(false)}>
            Continue on Sim
          </button>
          <button className="btn btn--primary" onClick={() => finish(true)}>
            Add Alpaca keys
          </button>
        </div>
      </div>
    </div>
  )
}
