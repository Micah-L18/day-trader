import { useEffect, useState, type ReactElement } from 'react'
import type { ConnectionState } from '@shared/types'
import { useStreamBridge } from '@renderer/state/useStreamBridge'
import { useHotkeys } from '@renderer/state/useHotkeys'
import { useSystemStore } from '@renderer/state/systemStore'
import { useChartStore } from '@renderer/state/chartStore'
import { useLayoutStore } from '@renderer/state/layoutStore'
import { useLiveStore } from '@renderer/state/liveStore'
import { WidgetBoard } from '@renderer/components/WidgetBoard'
import { LayoutTabs } from '@renderer/components/LayoutTabs'
import { AddWidgetMenu } from '@renderer/components/AddWidgetMenu'
import { AccountSelector } from '@renderer/components/AccountSelector'
import { RiskBar } from '@renderer/panels/Risk/RiskBar'
import { SettingsModal } from '@renderer/panels/Settings/SettingsModal'
import { OnboardingModal } from '@renderer/panels/Onboarding/OnboardingModal'
import { LiveArmModal } from '@renderer/panels/Live/LiveArmModal'
import { ScreenerModal } from '@renderer/panels/Screener/ScreenerModal'
import { OrderTicket } from '@renderer/panels/OrderTicket/OrderTicket'

function App(): ReactElement {
  useStreamBridge()
  useHotkeys()

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
      <div className="workspace-widgets">
        <WidgetBoard />
      </div>
      <RiskBar />
      <StatusBar />
      <SettingsModal />
      <OnboardingModal />
      <LiveArmModal />
      <ScreenerModal />
      <OrderTicket />
    </div>
  )
}

function TopBar(): ReactElement {
  const openSettings = useSystemStore((s) => s.openSettings)
  const openScreener = useSystemStore((s) => s.openScreener)
  const status = useSystemStore((s) => s.status)
  const label = status.provider === 'alpaca' ? 'Alpaca · paper' : 'Simulated feed'

  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="brand">◆ Daytrader</span>
        <LayoutTabs />
        <AddWidgetMenu />
      </div>
      <div className="topbar__center">
        <span className="market-pill">
          <span className={`conn__dot conn__dot--${status.market}`} /> {label}
        </span>
      </div>
      <div className="topbar__right">
        <AccountSelector />
        <button className="btn btn--ghost" onClick={openScreener}>
          🔎 Screener
        </button>
        <button className="btn btn--ghost" onClick={openSettings} title="Settings">
          ⚙
        </button>
      </div>
    </header>
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
