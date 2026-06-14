export interface AlpacaEndpoints {
  /** REST base for trading/account (paper vs live). */
  trading: string
  /** REST base for market data. */
  data: string
  /** Market-data websocket (v2). */
  dataStream: string
  feed: 'iex' | 'sip'
}

/**
 * Paper is the default and the only target until Phase 7. Live endpoints exist
 * here but are reached only behind the mode=live + ALLOW_LIVE_TRADING gate.
 */
export function alpacaEndpoints(live: boolean): AlpacaEndpoints {
  if (live) {
    return {
      trading: 'https://api.alpaca.markets',
      data: 'https://data.alpaca.markets',
      dataStream: 'wss://stream.data.alpaca.markets/v2/sip',
      feed: 'sip'
    }
  }
  return {
    trading: 'https://paper-api.alpaca.markets',
    data: 'https://data.alpaca.markets',
    dataStream: 'wss://stream.data.alpaca.markets/v2/iex',
    feed: 'iex'
  }
}
