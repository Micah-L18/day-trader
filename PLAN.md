# Legend-Style Day-Trading Terminal — Build Plan

**Working title:** Daytrader Terminal (rename later)
**For:** Claude Code (implementation agent) + the human owner
**Goal:** A **downloadable desktop app** that replicates the **Robinhood Legend** manual-trading terminal — rich charting, watchlists, one-click order entry, positions/P&L, and fully programmable **hotkeys** — backed by **Alpaca** market data + brokerage, **paper-first** with live trading gated behind explicit flags.

> This plan supersedes the earlier `BUILD_PLAN.md` (a Python/PySide6 *algorithmic* engine). That doc's **broker choice (Alpaca)** and its **safety guardrails** carry forward; its Python/PySide6 stack and algo-engine focus do **not**. `BUILD_PLAN.md` is kept for reference.

---

## 0. Decisions locked (from the owner)

| Decision | Choice | Why |
|---|---|---|
| Desktop framework | **Electron + React + TypeScript** | Most mature desktop stack; easiest websocket/streaming; web tech matches Legend's UI. |
| Data + broker | **Alpaca** | Official API, free **paper** sandbox, real-time **WebSocket v2** streaming, IEX market data, historical bars. |
| Money safety | **Paper/sim first; live gated behind flags** | Build & demo the entire UI with zero risk; real orders require explicit config + on-screen confirmation. |

---

## 1. Scope

### In scope (v1)
- Legend-style multi-panel UI: **watchlist**, **chart(s)**, **order ticket** (Buy/Sell/Short), **positions**, **recent orders**, **account/buying-power**, and an **L2-style** book panel.
- **Charting** (Lightweight Charts v5): candlesticks + **Volume** pane + **MACD** pane, interval selector (1s/10s/15s/1m/… up to 1D/1W/1M), crosshair OHLC readout, autoscale, and a small set of **drawing tools** (horizontal line, trend line).
- **Indicators** computed in-app: EMA, SMA, MACD, VWAP, RSI, Bollinger Bands (start with MACD + a couple; expand).
- **Order entry**: market / limit / stop / stop-limit, plus **bracket** (take-profit + protective stop). One-click trading from chart, watchlist, and positions.
- **Real-time** quote/trade/bar streaming + live order/fill/position updates (Alpaca WS v2). **Sim provider** for no-creds development.
- **Hotkeys**: configurable, in-app + global; buy/sell/flatten, change symbol, change interval, toggle panels, panic-flatten.
- **Layouts**: save/load named layouts + layout **tabs** (like the screenshot's "Untitled layout" / "Chart Layout"); dockable/resizable panels; multiple charts.
- **Persistence**: local SQLite for settings, watchlists, layouts, and an order/event journal.
- **Packaging**: downloadable installers for **macOS** (.dmg), **Linux** (.AppImage + .deb), **Windows** (.exe/NSIS).

### Out of scope (v1) / explicit caveats
- **Full TradingView-grade drawing tools** (Fibonacci, channels, patterns) and **90+ indicators**. Lightweight Charts ships none of these; v1 hand-builds a small set. Upgrade path: **TradingView Advanced Charts** (free but requires access request) — see §11.
- **True Nasdaq Level 2 depth-of-book.** Alpaca's free IEX feed does not provide full L2 like Robinhood Gold. v1 renders an L2-style panel from available quote data (sim book first). Faithful L2 needs a paid depth feed (§11).
- **Options & futures trading.** Equities only in v1 (Alpaca supports options later; can extend).
- **Live real-money trading** until Phase 7, behind explicit gating (§4).

---

## 2. Faithful Legend feature checklist (target)

Derived from the screenshot + Legend's public feature set:

- [ ] Top bar: layout tabs, "Add widget", account selector, market-status pill, window controls.
- [ ] Left rail: symbol header (name, price, % change), Buy/Short buttons, account summary (buying power × buckets), portfolio sparkline + range tabs (LIVE/1D/1W/1M/3M/YTD/1Y/ALL).
- [ ] Watchlist / Recent orders / Positions panels (sortable tables).
- [ ] Main chart: candlesticks, Buy/Short inline buttons, OHLCV readout, Volume sub-pane, MACD sub-pane, drawing toolbar, interval bar, autoscale, crosshair.
- [ ] One-click order entry from chart, watchlist, positions.
- [ ] Programmable hotkeys.
- [ ] Save/restore + template layouts; multi-chart (up to N).
- [ ] Level-2-style book (data-permitting).
- [ ] Dark theme matching Legend's palette.

---

## 3. Architecture

```
┌────────────────────────── Electron MAIN (Node) ──────────────────────────┐
│  App lifecycle · BrowserWindow · strict CSP · globalShortcut (hotkeys)    │
│                                                                           │
│  Secrets:  OS keychain via safeStorage  (Alpaca keys never touch renderer)│
│  Persist:  better-sqlite3  (settings, watchlists, layouts, journal)       │
│                                                                           │
│  Providers (interface-based, swappable):                                  │
│    ┌ MarketDataProvider ┐   ┌ Broker ┐                                    │
│    │ SimProvider (mock) │   │ Sim    │   ← default, no creds              │
│    │ AlpacaData (REST+WS)│  │ Alpaca │   ← paper by default               │
│    └────────────────────┘   └────────┘                                    │
│                                  │                                         │
│              ┌───────────────────▼─────────────────┐                      │
│              │  SafetyGate  (single submitOrder())  │  live gated (§4)     │
│              └───────────────────┬─────────────────┘                      │
│                                  ▼  Alpaca paper/live                      │
└───────────────── typed IPC (contextBridge in PRELOAD) ────────────────────┘
                                   │  window.api.*
┌────────────────────────── Electron RENDERER (React) ──────────────────────┐
│  Dock layout (tabs + resizable panels) · dark theme                       │
│  Panels: Chart (Lightweight Charts v5) · Watchlist · OrderTicket ·        │
│          Positions · Orders · Account · Level2                            │
│  State: Zustand stores + WS-over-IPC event bridge                         │
│  Hotkey engine (configurable keymap) · Indicators (MACD/EMA/VWAP/…)       │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key principle (carried from the old plan):** every order flows through **one** `SafetyGate.submitOrder()` chokepoint. No renderer path talks to the broker directly — all broker/data access lives in **main** and is exposed through a typed preload bridge.

---

## 4. Safety model (non-negotiable)

- **Paper is the default.** `mode: paper` hits Alpaca's paper endpoint (or the Sim broker). 
- **Live requires all three:** `mode: live` in config **AND** `ALLOW_LIVE_TRADING=1` in the environment **AND** a typed on-screen confirmation. Missing any → refuse to connect live.
- **No secrets in code/git.** Keys live in the OS keychain (`safeStorage`) or a git-ignored `.env`; ship `.env.example` with placeholders only.
- **Single submission chokepoint.** `SafetyGate.submitOrder()` is the only path to the broker. It enforces: max position size (shares/notional), max gross exposure, daily-loss halt, order sanity (positive qty, notional ceiling, buying-power), orders/min rate limit, and a **kill switch** / panic-flatten.
- **Server-side stops.** Protective stops placed *at the broker* (bracket/OTO), so positions stay protected if the app crashes.
- **Fail safe.** On ambiguous error (disconnect, unknown order state, data gap): stop trading and alert — never blind-retry submits.
- **Log everything.** Signals, order requests, broker responses, fills, rejections, risk decisions → SQLite journal + JSON logs.
- **Renderer is sandboxed:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible, strict CSP, no remote module.

---

## 5. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Electron** (latest LTS-ish) | electron-builder for packaging. |
| Build | **electron-vite** + Vite | `src/main`, `src/preload`, `src/renderer`. |
| UI | **React 18 + TypeScript** | Strict TS everywhere. |
| Charts | **Lightweight Charts v5** (Apache-2.0) | Multi-pane: candles + Volume + MACD. |
| Dock/layout | **dockview** or **flexlayout-react** | Tabbed, dockable, resizable Legend-style panels. |
| State | **Zustand** + lightweight WS→IPC event bridge | React Query optional for REST. |
| Broker + data | **Alpaca** via `@alpacahq/alpaca-trade-api` | REST history + WS v2 (data + trading streams). |
| DB | **better-sqlite3** (in main) | Sync, fast, single-user. |
| Secrets | Electron **safeStorage** (OS keychain) | Keys stay in main. |
| Money math | **decimal.js** (or integer cents) | Never float for prices/qty. |
| Testing | **Vitest** (unit) + **Playwright-Electron** (smoke) | No live-account tests. |
| Packaging | **electron-builder** | dmg / AppImage + deb / nsis. |
| Updates (later) | electron-updater | Optional Phase 6+. |

---

## 6. Repository structure (target)

```
day-trader/
├─ package.json · electron.vite.config.ts · electron-builder.yml
├─ tsconfig.json · tsconfig.node.json · tsconfig.web.json
├─ .env.example          # ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALLOW_LIVE_TRADING
├─ .gitignore           # .env, *.db, out/, dist/, node_modules/, logs/
├─ README.md · CLAUDE.md (conventions + guardrails)
├─ resources/           # app icons
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # lifecycle, window, CSP, globalShortcut
│  │  ├─ ipc/                     # typed IPC handlers
│  │  ├─ providers/
│  │  │  ├─ types.ts              # MarketDataProvider, Broker interfaces
│  │  │  ├─ alpaca/{data,broker,stream,rest}.ts
│  │  │  └─ sim/simProvider.ts    # mock/replay — default
│  │  ├─ risk/safetyGate.ts       # single submit chokepoint + live gating
│  │  ├─ store/{db,settings,layouts,watchlists,journal}.ts
│  │  └─ secrets/keychain.ts      # safeStorage
│  ├─ preload/index.ts            # contextBridge → window.api
│  ├─ shared/
│  │  ├─ types.ts                 # Bar, Quote, Order, Position, Account, Signal
│  │  ├─ indicators/{ema,macd,vwap,rsi,bbands}.ts
│  │  └─ ipc-contract.ts
│  └─ renderer/
│     ├─ index.html · main.tsx · app/App.tsx · app/theme.ts
│     ├─ layout/{DockLayout,panelRegistry,layoutTabs}.tsx
│     ├─ panels/
│     │  ├─ Chart/{LightweightChart,Toolbar,Intervals,Drawing}.tsx
│     │  ├─ Watchlist/ · OrderTicket/ · Positions/ · Orders/ · Account/ · Level2/
│     ├─ state/{stores,wsBridge}.ts
│     ├─ hotkeys/{keymap,handler,SettingsUI}.tsx
│     └─ components/                # shared UI
└─ tests/
   ├─ unit/{indicators,safetyGate,simProvider}.test.ts
   └─ e2e/smoke.spec.ts
```

---

## 7. Component notes

**Charting.** Lightweight Charts v5. Main pane = candlesticks; `addPane()` for Volume (histogram) and MACD (two lines + histogram). Indicators computed in `shared/indicators`. Drawing tools (h-line, trend line) via series/primitives; persisted per chart. OHLCV readout follows crosshair.

**Data/broker providers.** Interface first (`types.ts`): `getBars`, `subscribeQuotes/Trades/Bars`, `getAccount`, `getPositions`, `submitOrder`, `cancelOrder`, `getOrders`, `streamOrderUpdates`. **SimProvider** generates believable random-walk bars/quotes + simulated fills (zero creds). **Alpaca** implements REST history + WS v2 for live data and trading updates.

**Order ticket.** Side (Buy/Sell/Short), type (market/limit/stop/stop-limit), qty/notional, TIF, and bracket TP/SL. Submits only via `SafetyGate`. Inline mini-tickets on chart/watchlist/positions for one-click.

**Hotkeys.** Central keymap in settings (rebindable). In-app handler for buy/sell/flatten, symbol search, interval cycle, panel toggles; `globalShortcut` for app-focus + panic-flatten. Keybindings settings UI with conflict detection.

**Layouts.** Panel arrangement + symbols + chart settings saved to SQLite as named layouts; tabbed switching; ship 2–3 templates (Stocks / Chart-focus / Monitor).

---

## 8. Build phases (in order; meet acceptance before advancing)

**Phase 0 — Scaffold & shell.** electron-vite + React + TS, electron-builder config, dark theme, secure window (contextIsolation/CSP), CI.
*Accept:* `npm run dev` launches a dark empty shell; `npm run build` makes a host-OS installer.

**Phase 1 — Data layer (sim).** Provider interfaces, `SimProvider` streaming, shared types, IPC bridge, Zustand stores.
*Accept:* watchlist + chart update live from sim data with **zero credentials**.

**Phase 2 — Charting (Legend look).** Lightweight Charts v5: candles + Volume + MACD panes, interval bar, crosshair OHLC, basic drawing tools.
*Accept:* chart area visually matches the screenshot on sim data.

**Phase 3 — Alpaca paper integration.** REST history + WS v2 (data + trading), keychain key storage, settings UI for paper keys.
*Accept:* real IEX bars/quotes stream; paper account/positions/orders load.

**Phase 4 — Order entry + SafetyGate.** Order ticket + bracket, single submit chokepoint, paper placement, live positions/orders tables, panic-flatten.
*Accept:* place/cancel paper orders from ticket, chart, and watchlist; protective stops attach; gate tests pass.

**Phase 5 — Hotkeys + layouts.** Rebindable keymap (in-app + global), keybindings UI, save/load named layouts + tabs, dockable panels, multi-chart.
*Accept:* hotkeys for buy/sell/flatten/symbol/interval/panels work; layouts persist across restarts.

**Phase 6 — Packaging & polish.** Cross-platform installers, icons, onboarding for keys, README install docs; optional auto-update.
*Accept:* downloadable installers for mac/linux/win; fresh install runs in paper mode.

**Phase 7 — Live (human-gated).** Enable Alpaca live behind `mode=live` + `ALLOW_LIVE_TRADING=1` + typed confirmation. **CONFIRM with the human first.** Smallest size.

---

## 9. Testing
- **Unit (Vitest):** indicators (MACD/EMA correctness vs known values), `SafetyGate` (pass + reject per limit, kill-switch, daily-loss halt, live-gating), `SimProvider`.
- **E2E (Playwright-Electron):** smoke — app launches, chart renders, place a **sim** order, panic-flatten.
- **No test hits a live account.** Paper/sim/mock only.

## 10. Coding conventions (→ CLAUDE.md)
- Strict TypeScript; no `any` in shared contracts. Money via `decimal.js`/integer cents.
- All broker/data access in **main**; renderer only via typed `window.api`.
- Every order through `SafetyGate`; enforce by design (no other broker import in renderer).
- Fail safe on ambiguity; log every action. Conventional commits; run tests before completing a phase.

## 11. Upgrade paths & open questions
- **Richer charts:** swap/augment Lightweight Charts with **TradingView Advanced Charts** (full drawing suite + 100+ indicators; free, requires access request) once core is stable.
- **Real L2 depth:** add a paid depth feed (e.g., Polygon) for true Nasdaq L2.
- **Better market data:** Alpaca free = IEX (~2–5% of volume); upgrade to Alpaca Algo Trader Plus (full SIP) or Polygon when needed.
- **Options/futures:** extend providers + tickets later.
- **CONFIRM:** app name/branding; which OS installers to prioritize; whether to add auto-update; target post-PDT margin assumptions with the specific broker (per old plan's regulatory note).

---

## 12. Immediate next step
On approval, start **Phase 0**: scaffold the Electron + Vite + React + TS app with the secure window, dark theme, electron-builder config, and a runnable empty shell — committed to `claude/gallant-shannon-ofchn8`.
