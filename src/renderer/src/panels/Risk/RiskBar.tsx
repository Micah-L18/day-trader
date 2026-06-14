import { type ReactElement } from 'react'
import { useRiskStore } from '@renderer/state/riskStore'
import { signedUsd } from '@renderer/lib/format'

/** Kill switch + panic-flatten + day P&L. The renderer's risk controls. */
export function RiskBar(): ReactElement {
  const risk = useRiskStore((s) => s.risk)
  const setRisk = useRiskStore((s) => s.setRisk)

  const toggleKill = async (): Promise<void> => {
    setRisk(await window.api.risk.setKillSwitch(!risk.killSwitch))
  }
  const flatten = async (): Promise<void> => {
    await window.api.risk.flattenAll()
  }

  return (
    <div className="riskbar">
      <span className={`pnl ${risk.dailyPnl >= 0 ? 'up' : 'down'}`}>
        Day P&amp;L {signedUsd(risk.dailyPnl)}
      </span>
      {risk.dailyHalt && <span className="halt">● ENTRIES HALTED</span>}
      <span className="spacer" />
      <button
        className={`btn btn--sm ${risk.killSwitch ? 'btn--killon' : ''}`}
        onClick={toggleKill}
        title="Block all new orders"
      >
        ⏻ {risk.killSwitch ? 'Kill switch ON' : 'Kill switch'}
      </button>
      <button className="btn btn--sm btn--danger" onClick={flatten} title="Cancel orders and close all positions">
        ⚠ Flatten all
      </button>
    </div>
  )
}
