import { useEffect, useState, type ReactElement } from 'react'
import {
  CHART_RANGES,
  DEFAULT_INDICATORS,
  type IndicatorConfig,
  type PanelKind,
  type RangeKey,
  type Timeframe
} from '@shared/types'
import { useStreamBridge } from '@renderer/state/useStreamBridge'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { changePct, useMarketStore } from '@renderer/state/marketStore'
import { TicketForm } from '@renderer/panels/OrderTicket/TicketForm'
import { LightweightChart } from '@renderer/panels/Chart/LightweightChart'
import { IntervalBar } from '@renderer/components/IntervalBar'
import { IndicatorsMenu } from '@renderer/components/IndicatorsMenu'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { Orders } from '@renderer/panels/Orders/Orders'
import { Positions } from '@renderer/panels/Positions/Positions'
import { pct, usd } from '@renderer/lib/format'

export function PanelWindow({ panel, symbol }: { panel: PanelKind; symbol: string | null }): ReactElement {
  useStreamBridge({ loadWatchlist: false })
  const [interval, setInterval] = useState<Timeframe>('5Min')
  const [range, setRangeState] = useState<RangeKey>('1D')
  const [autoScale, setAutoScale] = useState(true)
  const [indicators, setIndicators] = useState<IndicatorConfig>({ ...DEFAULT_INDICATORS })

  const setRange = (r: RangeKey): void => {
    setRangeState(r)
    setInterval(CHART_RANGES.find((x) => x.key === r)?.interval ?? '5Min')
  }
  const toggleIndicator = (k: keyof IndicatorConfig): void =>
    setIndicators((c) => ({ ...c, [k]: !c[k] }))

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
          <PanelHeader
            symbol={symbol}
            tools={<IndicatorsMenu indicators={indicators} onToggle={toggleIndicator} />}
          />
          <LightweightChart
            symbol={symbol}
            interval={interval}
            range={range}
            autoScale={autoScale}
            indicators={indicators}
          />
          <IntervalBar
            range={range}
            onRange={setRange}
            value={interval}
            onChange={setInterval}
            autoScale={autoScale}
            onToggleAutoScale={() => setAutoScale(!autoScale)}
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

function PanelHeader({
  symbol,
  tools
}: {
  symbol: string | null
  tools?: ReactElement
}): ReactElement {
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
      <span className="spacer" />
      {tools}
    </div>
  )
}
