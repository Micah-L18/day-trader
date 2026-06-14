import { LIVE_CONFIRM_PHRASE } from '@shared/types'

export interface ArmEvaluation {
  /** Env gate: app mode=live AND ALLOW_LIVE_TRADING=1. */
  capable: boolean
  /** The typed on-screen confirmation. */
  confirm: string
  /** Whether live API keys are present (after any provided ones are stored). */
  hasLiveKeys: boolean
}

/**
 * Pure decision for arming live trading — all three gates must hold. Kept
 * separate from the IPC handler so the gating logic is unit-tested.
 */
export function evaluateArm(input: ArmEvaluation): { ok: boolean; message: string } {
  if (!input.capable) {
    return {
      ok: false,
      message: 'Live trading is not enabled. Launch with TRADING_MODE=live and ALLOW_LIVE_TRADING=1.'
    }
  }
  if (input.confirm !== LIVE_CONFIRM_PHRASE) {
    return { ok: false, message: `Type "${LIVE_CONFIRM_PHRASE}" exactly to confirm.` }
  }
  if (!input.hasLiveKeys) {
    return { ok: false, message: 'Enter your LIVE Alpaca API keys.' }
  }
  return { ok: true, message: 'Live trading ARMED — orders now hit your real account.' }
}
