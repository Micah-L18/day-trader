import { useEffect, useState, type ReactElement } from 'react'
import type { PanelKind, Timeframe } from '@shared/types'
import { useStreamBridge } from '@renderer/state/useStreamBridge'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { changePct, useMarketStore } from '@renderer/state/marketStore'
import { TicketForm } from '@renderer/panels/OrderTicket/TicketForm'
import { LightweightChart } from '@renderer/panels/Chart/LightweightChart'
import { IntervalBar } from '@renderer/components/IntervalBar'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { Orders } from '@renderer/panels/Orders/Orders'
import { Positions } from '@renderer/panels/Positions/Positions'
import { pct, usd } from '@renderer/lib/format'

/** Root for a detached panel window. Streams the same main-process data as the
 * primary window; seeds its symbol from the URL rather than the shared watchlist. */
export function PanelWindow({ panel, symbol }: { panel: PanelKind; symbol: string | null }): ReactElement {
  useStreamBridge({ loadWatchlist: false })
  const [chartInterval, setChartInterval] = useState<Timeframe>('1Min')
  const [chartAuto, setChartAuto] = useState(true)

  useEffect(() => {
    if (!symbol) return
    const w = useWatchlistStore.getState()
    w.setSymbols([symbol])
    w.select(symbol)
    void window.api.data.subscribe([symbol])
  }, [symbol])

  return (
    <div className="panel-window">
      {panel === 'ticket' && (
        <>
          <PanelHeader symbol={symbol} />
          <div className="panel-pad">
            <TicketForm />
          </div>
        </>
      )}
      {panel === 'chart' && (
        <>
          <PanelHeader symbol={symbol} />
          <LightweightChart symbol={symbol} interval={chartInterval} autoScale={chartAuto} />
          <IntervalBar
            value={chartInterval}
            onChange={setChartInterval}
            autoScale={chartAuto}
            onToggleAutoScale={() => setChartAuto(!chartAuto)}
          />
        </>
      )}
      {panel === 'watchlist' && (
        <div className="panel-scroll">
          <Watchlist />
        </div>
      )}
      {panel === 'orders' && (
        <div className="panel-scroll">
          <Orders />
        </div>
      )}
      {panel === 'positions' && (
        <div className="panel-scroll">
          <Positions />
        </div>
      )}
    </div>
  )
}

function PanelHeader({ symbol }: { symbol: string | null }): ReactElement {
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)
  const q = symbol ? quotes[symbol] : undefined
  const last = q ? q.last ?? q.bid : undefined
  const chg = symbol ? changePct(quotes, opens, symbol) : 0

  return (
    <div className="panel-head">
      <span className="panel-head__sym">{symbol ?? '—'}</span>
      <span>{last != null ? usd(last) : '—'}</span>
      <span className={chg >= 0 ? 'up' : 'down'}>{pct(chg)}</span>
    </div>
  )
}
