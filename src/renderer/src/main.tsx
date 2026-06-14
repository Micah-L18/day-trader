import React from 'react'
import ReactDOM from 'react-dom/client'
import type { PanelKind } from '@shared/types'
import App from './App'
import { PanelWindow } from './panels/PanelWindow'
import { ErrorBoundary } from './components/ErrorBoundary'
import './assets/global.css'

// A window is either the main app or a single detached panel (?panel=...).
const params = new URLSearchParams(window.location.search)
const PANELS: readonly PanelKind[] = ['ticket', 'chart', 'watchlist', 'positions', 'orders']
const panelParam = params.get('panel')
const panel = PANELS.includes(panelParam as PanelKind) ? (panelParam as PanelKind) : null
const symbol = params.get('symbol')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {panel ? <PanelWindow panel={panel} symbol={symbol} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
