import { useEffect, useState, type ReactElement } from 'react'

/**
 * Phase 0 shell. A static, dark, Legend-style skeleton that establishes the
 * panel geometry (left rail · chart · sub-panels · status bar) and proves the
 * secure IPC bridge works by reading the app version + trading mode from main.
 *
 * Each placeholder panel below becomes a real, data-driven component in later
 * phases (see PLAN.md §8). Nothing here talks to a broker yet.
 */
function App(): ReactElement {
  const [version, setVersion] = useState('…')
  const [mode, setMode] = useState<{ mode: string; liveAllowed: boolean }>({
    mode: 'paper',
    liveAllowed: false
  })

  useEffect(() => {
    window.api.getVersion().then(setVersion).catch(() => setVersion('?'))
    window.api.getTradingMode().then(setMode).catch(() => undefined)
  }, [])

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LeftRail />
        <ChartPanel />
      </div>
      <StatusBar version={version} mode={mode.mode} liveAllowed={mode.liveAllowed} />
    </div>
  )
}

function TopBar(): ReactElement {
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
        <span className="market-pill">● Market closed</span>
      </div>
      <div className="topbar__right">
        <button className="btn btn--ghost">Add widget</button>
        <button className="btn btn--ghost">Individual investing ⌄</button>
      </div>
    </header>
  )
}

function LeftRail(): ReactElement {
  return (
    <aside className="leftrail">
      <div className="symbol-head">
        <div className="symbol-search">🔍 UBXG</div>
        <h1 className="symbol-name">U-BX Technology Ltd.</h1>
        <div className="symbol-price">$7.80</div>
        <div className="symbol-change up">▲ $3.01 (62.84%)</div>
        <div className="trade-buttons">
          <button className="btn btn--buy">Buy</button>
          <button className="btn btn--short">Short</button>
        </div>
      </div>

      <section className="rail-section">
        <div className="rail-section__head">
          <span>Individual investing</span>
          <button className="btn btn--pill">Deposit</button>
        </div>
        <div className="account-value">$127.06</div>
        <div className="account-change up">▲ $0.05 (0.04%) Today</div>
        <div className="range-tabs">
          {['LIVE', '1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'].map((r) => (
            <button key={r} className={`range ${r === '1D' ? 'range--active' : ''}`}>
              {r}
            </button>
          ))}
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-section__title">Overview</div>
        {[
          ['Buying power', '$78.23'],
          ['Options buying power', '$78.23'],
          ['Futures buying power', '$78.23'],
          ['Crypto buying power', '$78.23']
        ].map(([k, v]) => (
          <div className="kv" key={k}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </section>

      <section className="rail-section rail-section--fill">
        <div className="rail-section__title">Positions</div>
        <div className="empty">No positions yet — placeholder (Phase 4).</div>
      </section>
    </aside>
  )
}

function ChartPanel(): ReactElement {
  return (
    <main className="chart">
      <div className="chart__toolbar">
        <div className="chart__symbol">UBXG · $7.80 <span className="up">▲ 62.84%</span></div>
        <div className="chart__tools">
          <span className="tool">＋ Indicators</span>
          <span className="tool">✎ Draw</span>
          <span className="tool">⤢</span>
        </div>
      </div>

      <div className="chart__surface">
        <div className="chart__pane chart__pane--price">
          <span className="pane-label">Candlesticks · Lightweight Charts v5 (Phase 2)</span>
        </div>
        <div className="chart__pane chart__pane--volume">
          <span className="pane-label">Volume</span>
        </div>
        <div className="chart__pane chart__pane--macd">
          <span className="pane-label">MACD (12, 26, 9)</span>
        </div>
      </div>

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

function StatusBar({
  version,
  mode,
  liveAllowed
}: {
  version: string
  mode: string
  liveAllowed: boolean
}): ReactElement {
  return (
    <footer className="statusbar">
      <span className={`mode-pill ${mode === 'live' ? 'mode-pill--live' : 'mode-pill--paper'}`}>
        {mode.toUpperCase()} TRADING
      </span>
      <span className="status-dim">Phase 0 shell · simulated/paper-first</span>
      <span className="spacer" />
      <span className="status-dim">live gate: {liveAllowed ? 'armed' : 'locked'}</span>
      <span className="status-dim">v{version}</span>
    </footer>
  )
}

export default App
