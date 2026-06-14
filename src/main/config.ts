import type { TradingMode } from '@shared/types'

export interface AppConfig {
  mode: TradingMode
  liveAllowed: boolean
}

/**
 * Resolve mode from the environment, enforcing the live-trading hard gate
 * (PLAN.md §4): the app only runs `live` when mode=live AND ALLOW_LIVE_TRADING=1.
 * Anything else collapses to paper. (Provider choice lives in persisted settings.)
 */
export function loadConfig(): AppConfig {
  const liveAllowed = process.env.ALLOW_LIVE_TRADING === '1'
  const requestedLive = process.env.TRADING_MODE === 'live'
  const mode: TradingMode = requestedLive && liveAllowed ? 'live' : 'paper'
  return { mode, liveAllowed }
}
