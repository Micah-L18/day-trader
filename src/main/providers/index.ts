import type { AlpacaCredentials, ConnectionState, ProviderKind } from '@shared/types'
import { PriceEngine } from './sim/priceEngine'
import { SimBroker } from './sim/simBroker'
import { SimMarketData } from './sim/simMarketData'
import { AlpacaMarketData } from './alpaca/alpacaMarketData'
import { AlpacaBroker } from './alpaca/alpacaBroker'
import type { Providers } from './types'

export interface CreateProvidersOptions {
  kind: ProviderKind
  creds: AlpacaCredentials | null
  live?: boolean
  onStatus?: (which: 'market' | 'trading', state: ConnectionState, message?: string) => void
}

/**
 * Build the market-data + broker pair for the chosen provider. Alpaca requires
 * credentials; anything else (or missing creds) falls back to the sim so the
 * app always runs.
 */
export function createProviders(opts: CreateProvidersOptions): Providers {
  if (opts.kind === 'alpaca' && opts.creds) {
    return {
      marketData: new AlpacaMarketData(opts.creds, {
        live: opts.live,
        onStatus: (s, m) => opts.onStatus?.('market', s, m)
      }),
      broker: new AlpacaBroker(opts.creds, {
        live: opts.live,
        onStatus: (s, m) => opts.onStatus?.('trading', s, m)
      })
    }
  }
  const engine = new PriceEngine()
  return { marketData: new SimMarketData(engine), broker: new SimBroker(engine) }
}

export type { Providers } from './types'
