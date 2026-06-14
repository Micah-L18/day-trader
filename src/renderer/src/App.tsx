import { useEffect, useState, type ReactElement } from 'react'
import type { ConnectionState } from '@shared/types'
import { useAccountStore } from '@renderer/state/accountStore'
import { changePct, useMarketStore } from '@renderer/state/marketStore'
import { useWatchlistStore } from '@renderer/state/watchlistStore'
import { useSystemStore } from '@renderer/state/systemStore'
import { useTicketStore } from '@renderer/state/ticketStore'
import { useStreamBridge } from '@renderer/state/useStreamBridge'
import { useHotkeys } from '@renderer/state/useHotkeys'
import { Watchlist } from '@renderer/panels/Watchlist/Watchlist'
import { LightweightChart } from '@renderer/panels/Chart/LightweightChart'
import { SettingsModal } from '@renderer/panels/Settings/SettingsModal'
import { OnboardingModal } from '@renderer/panels/Onboarding/OnboardingModal'
import { LiveArmModal } from '@renderer/panels/Live/LiveArmModal'
import { OrderTicket } from '@renderer/panels/OrderTicket/OrderTicket'
import { Orders } from '@renderer/panels/Orders/Orders'
import { Positions } from '@renderer/panels/Positions/Positions'
import { RiskBar } from '@renderer/panels/Risk/RiskBar'
import { PopOutButton } from '@renderer/components/PopOutButton'
import { IntervalBar } from '@renderer/components/IntervalBar'
import { LayoutTabs } from '@renderer/components/LayoutTabs'
import { RailResizer } from '@renderer/components/RailResizer'
import { useChartStore } from '@renderer/state/chartStore'
import { activeLayout, useLayoutStore } from '@renderer/state/layoutStore'
import { useLiveStore } from '@renderer/state/liveStore'
import { pct, signedUsd, usd } from '@renderer/lib/format'

/**
 * Phase 1 shell. The Legend-style skeleton from Phase 0, now driven by the
 * simulated data layer: the left rail, watchlist, positions, and chart all
 * update live from streamed quotes/bars with zero credentials.
 */
function App(): ReactElement {
  useStreamBridge()
  useHotkeys()

  const railWidth = useLayoutStore((s) => activeLayout(s)?.railWidth ?? 320)
  const loaded = useLayoutStore((s) => s.loaded)
  const interval = useChartStore((s) => s.interval)
  const liveArmed = useLiveStore((s) => s.live.armed)

  useEffect(() => {
    void useLayoutStore.getState().load()
  }, [])
  useEffect(() => {
    if (loaded) useLayoutStore.getState().updateActive({ interval })
  }, [interval, loaded])

  return (
    <div className={`app ${liveArmed ? 'app--live' : ''}`}>
      <TopBar />
      <div className="workspace" style={{ gridTemplateColumns: `${railWidth}px 5px 1fr` }}>
        <LeftRail />
        <RailResizer />
        <ChartPanel />
      </div>
      <RiskBar />
      <StatusBar />
      <SettingsModal />
      <OnboardingModal />
      <LiveArmModal />
      <OrderTicket />
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
        <LayoutTabs />
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
  const openTicket = useTicketStore((s) => s.openTicket)

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
        <button className="btn btn--buy" onClick={() => openTicket('buy')}>
          Buy
        </button>
        <button className="btn btn--short" onClick={() => openTicket('sell')}>
          Short
        </button>
      </div>
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

function LeftRail(): ReactElement {
  return (
    <aside className="leftrail">
      <SymbolHeader />
      <AccountSummary />
      <Watchlist />
      <Orders />
      <Positions />
    </aside>
  )
}

function ChartPanel(): ReactElement {
  const selected = useWatchlistStore((s) => s.selected)
  const quotes = useMarketStore((s) => s.quotes)
  const opens = useMarketStore((s) => s.opens)
  const interval = useChartStore((s) => s.interval)
  const setInterval = useChartStore((s) => s.setInterval)
  const autoScale = useChartStore((s) => s.autoScale)
  const setAutoScale = useChartStore((s) => s.setAutoScale)

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
          <PopOutButton panel="chart" symbol={selected} title="Pop chart into its own window" />
        </div>
      </div>

      <LightweightChart symbol={selected} interval={interval} autoScale={autoScale} />

      <IntervalBar
        value={interval}
        onChange={setInterval}
        autoScale={autoScale}
        onToggleAutoScale={() => setAutoScale(!autoScale)}
      />
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
  const status = useSystemStore((s) => s.status)
  const openLiveArm = useSystemStore((s) => s.openLiveArm)
  const live = useLiveStore((s) => s.live)
  const setLive = useLiveStore((s) => s.setLive)

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  const disarm = async (): Promise<void> => {
    setLive(await window.api.live.disarm())
  }

  return (
    <footer className="statusbar">
      <span className={`mode-pill ${live.armed ? 'mode-pill--live' : 'mode-pill--paper'}`}>
        {live.armed ? '● LIVE — REAL MONEY' : 'PAPER TRADING'}
      </span>
      <span className="status-dim">provider: {status.provider}</span>
      <ConnDot label="data" state={status.market} />
      <ConnDot label="broker" state={status.trading} />
      {status.message && <span className="status-dim">{status.message}</span>}
      <span className="spacer" />
      {live.capable ? (
        live.armed ? (
          <button className="btn btn--sm btn--danger" onClick={disarm}>
            Disarm live
          </button>
        ) : (
          <button className="btn btn--sm btn--danger" onClick={openLiveArm}>
            Arm live…
          </button>
        )
      ) : (
        <span className="status-dim">live gate: locked</span>
      )}
      <span className="status-dim">v{version}</span>
    </footer>
  )
}

export default App
