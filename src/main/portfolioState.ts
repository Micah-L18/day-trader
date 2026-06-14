import type { ProviderKind } from '@shared/types'

/** The active portfolio's provider config, read by the provider build closure. */
export const activePortfolio: { kind: ProviderKind; startingCash: number } = {
  kind: 'sim',
  startingCash: 50_000
}
