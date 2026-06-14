import type { AppConfig } from '../config'
import { PriceEngine } from './sim/priceEngine'
import { SimBroker } from './sim/simBroker'
import { SimMarketData } from './sim/simMarketData'
import type { Providers } from './types'

/**
 * Build the market-data + broker pair for the configured provider. Sim is the
 * default (no credentials); the Alpaca case lands in Phase 3 and slots in here
 * without touching IPC or the renderer.
 */
export function createProviders(config: AppConfig): Providers {
  switch (config.provider) {
    case 'sim':
    default: {
      const engine = new PriceEngine()
      return {
        marketData: new SimMarketData(engine),
        broker: new SimBroker(engine)
      }
    }
  }
}

export type { Providers } from './types'
