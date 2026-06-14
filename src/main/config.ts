import type { TradingMode } from '@shared/types'

export type ProviderKind = 'sim' | 'alpaca'

export interface AppConfig {
  provider: ProviderKind
  mode: TradingMode
  liveAllowed: boolean
}

/**
 * Resolve runtime config from the environment, enforcing the live-trading hard
 * gate (PLAN.md §4): the app only runs `live` when mode=live AND
 * ALLOW_LIVE_TRADING=1. Anything else collapses to paper.
 */
export function loadConfig(): AppConfig {
  const liveAllowed = process.env.ALLOW_LIVE_TRADING === '1'
  const provider: ProviderKind = process.env.PROVIDER === 'alpaca' ? 'alpaca' : 'sim'
  const requestedLive = process.env.TRADING_MODE === 'live'
  const mode: TradingMode = requestedLive && liveAllowed ? 'live' : 'paper'
  return { provider, mode, liveAllowed }
}
