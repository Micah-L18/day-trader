# Day-Trader

Infrastructure for **US-equities day trading** with a mandatory risk-control
chokepoint. The same strategy and engine code runs in three modes — **backtest**,
**paper**, and **live** — selected by config; promoting a strategy across stages
requires no strategy rewrites.

> ⚠️ **This is trading infrastructure, not a profitable strategy.** The bundled
> MA-crossover strategy exists only to exercise the pipeline. Edge comes from
> strategy research; this repo is the plumbing around one.

## Safety guardrails (non-negotiable)

- **Paper by default.** `TRADING_MODE` defaults to `paper`. Reaching a live
  account requires **both** `TRADING_MODE=live` **and** `ALLOW_LIVE_TRADING=1`;
  the settings loader refuses to start otherwise.
- **One chokepoint.** Every order flows through `RiskLayer.submit`. The broker
  rejects any `submit_order` made outside the risk layer's approval context
  (`ChokepointError`) — there is no path that bypasses risk checks.
- **Server-side stops.** Entries attach a protective stop *at the broker*
  (bracket/OTO), so positions stay protected if the app crashes.
- **Fail safe.** On disconnect/ambiguous state the engine pauses new entries and
  alerts; it never blind-retries order submission.
- **No secrets in git.** Keys live in `.env` (git-ignored). See `.env.example`.

## Architecture

```
Desktop UI (PySide6) ── monitors/controls ──┐
                                             ▼
Market Data ──▶ Strategy Engine ──▶ Risk Layer ──▶ Broker API ──▶ Broker/Exchange
     │                │                  │              │
     └────────────────┴──────────────────┴──────────────┘
                          ▼
                 Persistence & Logging  (every signal, order, fill, decision)
```

| Layer | Module | Notes |
|---|---|---|
| Config | `trading.config.settings` | pydantic-settings; enforces the live gate |
| Models | `trading.core.models` | frozen dataclasses, `Decimal` money |
| Data | `trading.data.{base,alpaca,historical}` | one interface; Alpaca + replay |
| Broker | `trading.broker.{base,alpaca,paper_sim}` | chokepoint guard lives here |
| Strategy | `trading.strategy.*` | pure signal generators |
| **Risk** | `trading.risk.risk_layer` | the only caller of `submit_order` |
| Engine | `trading.engine.engine` | one loop for all three modes |
| Persistence | `trading.persistence.*` | SQLite via SQLAlchemy |
| Backtest | `trading.backtest.*` | replay + sim broker + metrics |

## Setup

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # core + test tooling
pip install -e ".[alpaca]"       # add the broker/data SDK (for paper/live)
cp .env.example .env             # then fill in Alpaca paper keys
```

## Usage

```bash
# Phase 2 — run the example strategy on synthetic data (no network needed):
trader backtest --symbols AAPL MSFT --periods 500

# ...or on your own CSV (columns: symbol,ts,open,high,low,close,volume):
trader backtest --csv bars.csv --symbols AAPL --fast 10 --slow 30

# Phase 1 — read the paper account / stream data (needs Alpaca keys):
trader account
trader bars --symbols AAPL --days 5 --timeframe 1Min
trader stream --symbols AAPL          # quotes; add --bars for bars

# Phase 3/4 — run the engine live against PAPER:
trader run --fast 10 --slow 30
```

## Testing

```bash
pytest                 # full suite — never touches the network or a live account
pytest tests/test_risk_layer.py   # the priority suite (a pass+reject per limit)
ruff check src tests   # lint
mypy                   # type-check
```

## Build status (see `BUILD_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Plumbing: config, models, Alpaca data/broker | ✅ implemented |
| 2 | Backtest harness + example strategy + metrics | ✅ implemented |
| 3 | Engine + Risk Layer (all checks) + persistence | ✅ implemented & tested |
| 4 | Paper hardening: partial fills, reconnect, sessions | ⚙️ engine supports it; needs an extended paper run to sign off |
| 5 | PySide6 desktop UI + kill switch | 🚧 scaffold in `trading.ui.app` |
| 6 | Live (human-gated) | ⛔ gated — do not enable without sign-off |

## Decisions awaiting confirmation (BUILD_PLAN §9)

Current defaults (all changeable via `.env`): **Alpaca paper**, **IEX** (free)
data, **1-minute** bars, multi-symbol-capable universe. Before go-live, confirm:
go-live broker & its post-PDT margin status, data tier, strategy timeframe, and
the launch universe.
