import { useEffect, useState, type ReactElement } from 'react'
import type { ConnectionState, TradingModeInfo } from '@shared/types'
import { useAccountStore } from '@renderer/state/accountStore'
import { changePct, useMarketStore } from '@renderer/state/marketStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { useSystemStore } from '@renderer/state/systemStore'
import { useStreamBridge } from '@renderer/state/useStreamBridge'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { LightweightChart } from '@renderer/panels/Chart/LightweightChart'
import { SettingsModal } from '@renderer/panels/Settings/SettingsModal'
import { pct, signedUsd, usd } from '@renderer/lib/format'

/**
 * Phase 1 shell. The Legend-style skeleton from Phase 0, now driven by the
 * simulated data layer: the left rail, watchlist, positions, and chart all
 * update live from streamed quotes/bars with zero credentials.
 */
function App(): ReactElement {
  useStreamBridge()

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LeftRail />
        <ChartPanel />
      </div>
      <StatusBar />
      <SettingsModal />
    </div>
  )
}

function TopBar(): ReactElement {
  const openSettings = useSystemStore((s) => s.openSettings)
  const status = useSystemStore((s) => s.status)
  const label = status.provider === 'alpaca' ? 'Alpaca · paper' : 'Simulated feed'

  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="brand">◆ Daytrader</span>
        <nav className="tabs">
          <button className="tab tab--active">Untitled layout</button>
          <button className="tab">Chart Layout</button>
          <button className="tab tab--add">＋</button>
        </nav>
      </div>
      <div className="topbar__center">
        <span className="market-pill">
          <span className={`conn__dot conn__dot--${status.market}`} /> {label}
        </span>
      </div>
      <div className="topbar__right">
        <button className="btn btn--ghost">Add widget</button>
        <button className="btn btn--ghost">Individual investing ⌄</button>
        <button className="btn btn--ghost" onClick={openSettings} title="Settings">
          ⚙
        </button>
      </div>
    </header>
  )
}

function SymbolHeader(): ReactElement {
  const selected = useWatchlistStore((s) => s.selected)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)

  const q = selected ? quotes[selected] : undefined
  const last = q ? q.last ?? q.bid : undefined
  const chg = selected ? changePct(quotes, opens, selected) : 0
  const open = selected ? opens[selected] : undefined
  const chgAbs = last != null && open != null ? last - open : 0
  const up = chg >= 0

  return (
    <div className="symbol-head">
      <div className="symbol-search">🔍 {selected ?? '—'}</div>
      <h1 className="symbol-name">{selected ?? 'Select a symbol'}</h1>
      <div className="symbol-price">{last != null ? usd(last) : '—'}</div>
      <div className={`symbol-change ${up ? 'up' : 'down'}`}>
        {up ? '▲' : '▼'} {signedUsd(chgAbs)} ({pct(chg)})
      </div>
      <div className="trade-buttons">
        <button className="btn btn--buy">Buy</button>
        <button className="btn btn--short">Short</button>
      </div>
      <div className="hint">Order entry arrives in Phase 4 (behind the SafetyGate).</div>
    </div>
  )
}

function AccountSummary(): ReactElement {
  const account = useAccountStore((s) => s.account)

  return (
    <section className="rail-section">
      <div className="rail-section__head">
        <span>Individual investing</span>
        <button className="btn btn--pill">Deposit</button>
      </div>
      <div className="account-value">{usd(account?.equity)}</div>
      <div className="account-change up">Paper account · simulated</div>
      <div className="kv" style={{ marginTop: 10 }}>
        <span>Buying power</span>
        <span>{usd(account?.buyingPower)}</span>
      </div>
      <div className="kv">
        <span>Cash</span>
        <span>{usd(account?.cash)}</span>
      </div>
    </section>
  )
}

function Positions(): ReactElement {
  const positions = useAccountStore((s) => s.positions)

  return (
    <section className="rail-section rail-section--fill">
      <div className="rail-section__title">Positions</div>
      {positions.length === 0 ? (
        <div className="empty">No positions.</div>
      ) : (
        <table className="postable">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Avg</th>
              <th>Value</th>
              <th>P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol}>
                <td className="postable__sym">{p.symbol}</td>
                <td>{p.qty}</td>
                <td>{usd(p.avgPrice)}</td>
                <td>{usd(p.marketValue)}</td>
                <td className={p.unrealizedPnl >= 0 ? 'up' : 'down'}>
                  {signedUsd(p.unrealizedPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function LeftRail(): ReactElement {
  return (
    <aside className="leftrail">
      <SymbolHeader />
      <AccountSummary />
      <Watchlist />
      <Positions />
    </aside>
  )
}

function ChartPanel(): ReactElement {
  const selected = useWatchlistStore((s) => s.selected)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)

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
          <span className="tool">＋ Indicators</span>
          <span className="tool">✎ Draw</span>
          <span className="tool">⤢</span>
        </div>
      </div>

      <LightweightChart symbol={selected} />

      <div className="chart__intervals">
        {['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'].map((i) => (
          <button key={i} className="range">
            {i}
          </button>
        ))}
        <span className="spacer" />
        {['10s', '15s', '1m'].map((i) => (
          <button key={i} className={`range ${i === '1m' ? 'range--active' : ''}`}>
            {i}
          </button>
        ))}
      </div>
    </main>
  )
}

function ConnDot({ label, state }: { label: string; state: ConnectionState }): ReactElement {
  return (
    <span className="conn">
      <span className={`conn__dot conn__dot--${state}`} />
      {label}
    </span>
  )
}

function StatusBar(): ReactElement {
  const [version, setVersion] = useState('…')
  const [info, setInfo] = useState<TradingModeInfo>({
    mode: 'paper',
    liveAllowed: false,
    provider: 'sim'
  })
  const status = useSystemStore((s) => s.status)

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
    void window.api.getTradingMode().then(setInfo)
  }, [])

  return (
    <footer className="statusbar">
      <span
        className={`mode-pill ${info.mode === 'live' ? 'mode-pill--live' : 'mode-pill--paper'}`}
      >
        {info.mode.toUpperCase()} TRADING
      </span>
      <span className="status-dim">provider: {status.provider}</span>
      <ConnDot label="data" state={status.market} />
      <ConnDot label="broker" state={status.trading} />
      {status.message && <span className="status-dim">{status.message}</span>}
      <span className="spacer" />
      <span className="status-dim">live gate: {info.liveAllowed ? 'armed' : 'locked'}</span>
      <span className="status-dim">v{version}</span>
    </footer>
  )
}

export default App
