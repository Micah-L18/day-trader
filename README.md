# Daytrader Terminal

A downloadable desktop **day-trading terminal** that replicates the Robinhood
Legend experience — rich charting, watchlists, one-click order entry,
positions/P&L, and programmable hotkeys — backed by **Alpaca**.

> **Paper-first.** The app defaults to simulated/paper trading. Real-money
> trading is gated behind explicit flags + an on-screen confirmation. See
> [`PLAN.md`](./PLAN.md) §4.

## Status

🚧 **Phase 0 — scaffold.** Secure Electron + Vite + React + TypeScript shell
with the Legend-style layout skeleton and packaging config. Data, charts,
orders, hotkeys, and layouts land in later phases (see [`PLAN.md`](./PLAN.md) §8).

## Tech stack

Electron · electron-vite · React 18 · TypeScript · (Lightweight Charts v5,
Alpaca SDK, better-sqlite3 — added in later phases)

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
```

Artifacts are written to `dist/`.

## Configuration

Copy `.env.example` to `.env` (git-ignored) and add your Alpaca **paper** keys
when Phase 3 lands. Real-money trading additionally requires `ALLOW_LIVE_TRADING=1`
and app `mode=live` — keep both off until you intend to trade live.

## Project layout

```
src/
  main/      Electron main process — windows, IPC, providers, broker, safety gate
  preload/   contextBridge — the only bridge between renderer and main
  renderer/  React UI (panels, chart, hotkeys, layouts)
  shared/    types + indicators shared across processes
```

See [`PLAN.md`](./PLAN.md) for the full architecture and phased roadmap.
