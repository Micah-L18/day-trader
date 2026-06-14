import { type ReactElement } from 'react'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { changePct, useMarketStore } from '@renderer/state/marketStore'
import { useChartStore } from '@renderer/state/chartStore'
import { useDrawingStore } from '@renderer/state/drawingStore'
import { useTicketStore } from '@renderer/state/ticketStore'
import { LightweightChart } from '@renderer/panels/Chart/LightweightChart'
import { IntervalBar } from '@renderer/components/IntervalBar'
import { IndicatorsMenu } from '@renderer/components/IndicatorsMenu'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { pct, usd } from '@renderer/lib/format'

export function ChartPanel(): ReactElement {
  const selected = useWatchlistStore((s) => s.selected)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)
  const interval = useChartStore((s) => s.interval)
  const setInterval = useChartStore((s) => s.setInterval)
  const range = useChartStore((s) => s.range)
  const setRange = useChartStore((s) => s.setRange)
  const autoScale = useChartStore((s) => s.autoScale)
  const setAutoScale = useChartStore((s) => s.setAutoScale)
  const drawMode = useChartStore((s) => s.drawMode)
  const setDrawMode = useChartStore((s) => s.setDrawMode)
  const indicators = useChartStore((s) => s.indicators)
  const toggleIndicator = useChartStore((s) => s.toggleIndicator)
  const openTicket = useTicketStore((s) => s.openTicket)

  const q = selected ? quotes[selected] : undefined
  const last = q ? q.last ?? q.bid : undefined
  const chg = selected ? changePct(quotes, opens, selected) : 0
  const up = chg >= 0

  return (
    <main className="chart">
      <div className="chart__toolbar">
        <div className="chart__symbol">
          {selected ?? '—'} · {last != null ? usd(last) : '—'}{' '}
          <span className={up ? 'up' : 'down'}>{pct(chg)}</span>
        </div>
        <div className="chart__tools">
          <button className="chip chip--buy" onClick={() => openTicket('buy')}>
            Buy
          </button>
          <button className="chip chip--sell" onClick={() => openTicket('sell')}>
            Sell
          </button>
          <IndicatorsMenu indicators={indicators} onToggle={toggleIndicator} />
          <span
            className={`tool ${drawMode ? 'tool--on' : ''}`}
            onClick={() => setDrawMode(!drawMode)}
            title="Click the chart to add a horizontal line"
          >
            ✎ Draw
          </span>
          <span
            className="tool"
            onClick={() => selected && useDrawingStore.getState().clear(selected)}
            title="Clear lines"
          >
            ⊘
          </span>
          <PopOutButton panel="chart" symbol={selected} title="Pop chart into its own window" />
        </div>
      </div>

      <LightweightChart
        symbol={selected}
        interval={interval}
        range={range}
        autoScale={autoScale}
        indicators={indicators}
        drawMode={drawMode}
      />

      <IntervalBar
        range={range}
        onRange={setRange}
        value={interval}
        onChange={setInterval}
        autoScale={autoScale}
        onToggleAutoScale={() => setAutoScale(!autoScale)}
      />
    </main>
  )
}
