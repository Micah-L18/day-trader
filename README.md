# Daytrader Terminal

A downloadable desktop **day-trading terminal** that replicates the Robinhood
Legend experience — rich charting, watchlists, one-click order entry,
positions/P&L, and programmable hotkeys — backed by **Alpaca**.

> **Paper-first.** The app defaults to simulated/paper trading. Real-money
> trading is gated behind explicit flags + an on-screen confirmation. See
> [`PLAN.md`](./PLAN.md) §4.

## Status

Phases 0–5 complete (see [`PLAN.md`](./PLAN.md) §8):

- **Charting** — Lightweight Charts v5: candles + Volume + MACD panes, switchable
  intervals (1m–1D) with live aggregation.
- **Data/broker** — pluggable providers behind one seam: a credential-free **Sim**
  (default) and **Alpaca** paper (REST history + WebSocket v2), hot-swappable.
- **Order entry** — floating/detachable ticket (market/limit/stop/stop-limit +
  bracket), one-click close, cancel — all through the single **SafetyGate**
  (kill switch, daily-loss halt, exposure/rate/notional limits, panic-flatten).
- **Hotkeys** — fully rebindable in-app keymap + a global panic key.
- **Multi-window** — pop any panel (chart/ticket/watchlist/…) into its own OS window.
- **Layouts** — named tabs + a resizable rail, persisted across restarts.

## Tech stack

Electron · electron-vite · React 19 · TypeScript · Lightweight Charts v5 ·
Alpaca (REST + WS v2) · zustand · Vitest. Local state persisted as JSON in
userData (keys encrypted via the OS keychain).

## Prerequisites

- Node.js 20+ and npm
- A desktop OS (macOS / Linux / Windows) to run the GUI

## Develop

```bash
npm install
npm run dev          # launches the Electron app with HMR
```

> The dev command opens a desktop window, so run it on your own machine
> (a headless CI/container can build but not display the GUI).

## Type-check & build

```bash
npm run typecheck    # tsc across main/preload + renderer
npm run build        # bundles main, preload, renderer into out/
```

## Package a downloadable installer

```bash
npm run build:mac    # .dmg
npm run build:linux  # .AppImage + .deb
npm run build:win    # .exe (NSIS)
npm run build:unpack # unpacked app dir (fast sanity check, no installer)
npm run icon         # regenerate build/icon.png (committed; rarely needed)
```

Artifacts are written to `dist/`. A fresh install launches in **paper/sim mode**
with a first-run welcome — no account or config needed to start.

### First run on macOS (unsigned build)

These builds aren't notarized with a paid Apple Developer ID, so Gatekeeper may
block the first launch. Any one of:

- **Right-click the app → Open → Open** (one-time), or
- strip the quarantine flag: `xattr -dr com.apple.quarantine "/Applications/Daytrader Terminal.app"`, or
- if it quits immediately on Apple Silicon, ad-hoc sign it:
  `codesign --force --deep --sign - "/Applications/Daytrader Terminal.app"`

## Configuration

The app stores everything it needs locally (no `.env` required):

- **Provider + Alpaca paper keys** — set in-app via **⚙ Settings**. Keys are
  encrypted in the OS keychain; the renderer never sees them.
- **Watchlist, hotkeys, layouts** — persisted as JSON in the app's userData dir.

Real-money trading is gated off and additionally requires `ALLOW_LIVE_TRADING=1`
plus app `mode=live` (Phase 7) — keep both off until you intend to trade live.

## Project layout

```
src/
  main/      Electron main process — windows, IPC, providers, broker, safety gate
  preload/   contextBridge — the only bridge between renderer and main
  renderer/  React UI (panels, chart, hotkeys, layouts)
  shared/    types + indicators shared across processes
```

See [`PLAN.md`](./PLAN.md) for the full architecture and phased roadmap.
