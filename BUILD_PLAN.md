# Day Trading Desktop App — Build Plan

**For:** Claude Code (implementation agent)
**Target:** Python desktop app for **US equities** day trading, running on **macOS and Linux**, with **live trading** as the eventual goal.
**How to use this doc:** Build in the phases defined in §7, in order. Do not jump ahead to live trading. Treat §2 (Guardrails) and §6.5 (Risk Layer) as non-negotiable. Stop and ask the human at each "CONFIRM" marker.

---

## 1. Project goal

A self-contained desktop application that can:

1. Stream and store real-time + historical US equity market data.
2. Run trading strategies through an event loop that behaves identically across backtest, paper, and live modes.
3. Route every order through a single risk-control chokepoint before it reaches a broker.
4. Execute orders against a broker API (Alpaca first; designed to swap to Interactive Brokers later).
5. Present a desktop UI for monitoring positions, P&L, logs, and a manual kill switch.

The hard part of profitable trading is *strategy edge*, not software. This app is the infrastructure around a strategy; it does not assume any strategy is profitable.

---

## 2. Guardrails (read first — do not violate)

- **Live trading is gated.** Code must default to **paper trading**. Switching to a live broker account requires an explicit config flag (`mode: live`) AND a separate confirmation env var (e.g. `ALLOW_LIVE_TRADING=1`). If either is missing, refuse to connect to a live account.
- **No secrets in code or git.** API keys live in environment variables or a `.env` file that is git-ignored. Never hardcode keys. Provide a `.env.example` with placeholder names only.
- **Every order passes through the Risk Layer (§6.5).** There must be no code path that submits an order directly to the broker, bypassing risk checks. Enforce this with a single submission interface.
- **Server-side stops.** Protective stop-loss orders must be placed *at the broker*, not held only in-app, so positions stay protected if the app crashes.
- **Fail safe, not open.** On any ambiguous error (disconnect, unknown order state, data gap), the default action is to stop trading and alert — never to retry-submit blindly.
- **Log everything.** Every signal, order request, broker response, fill, rejection, and risk-check decision is persisted (§6.6).

### Regulatory note (context, not a code task)
As of **June 4, 2026**, FINRA eliminated the Pattern Day Trader rule and the $25,000 minimum-equity requirement, replacing it with a real-time intraday margin framework; the standard margin-account minimum is now $2,000. Brokers are phasing the new framework in through October 20, 2027, so the human must confirm with their specific broker whether the old $25K flag still applies. **CONFIRM with human before assuming any minimum.**

---

## 3. Tech stack (use these specific choices)

| Concern | Choice | Notes |
|---|---|---|
| Language | Python 3.11+ | Use type hints throughout. |
| Broker + data (phase 1) | **Alpaca** via `alpaca-py` | Official SDK. Do **not** use the deprecated `alpaca-trade-api`. Free paper-trading sandbox. |
| Broker (later option) | Interactive Brokers via **`ib_async`** | `ib_async` is the maintained successor to `ib_insync` (original author passed away early 2024; project renamed under a new org). Do **not** start on `ib_insync`. Requires TWS / IB Gateway running locally. |
| Market data (free tier) | Alpaca Basic = IEX feed only (~2–5% of consolidated volume) | Fine for development/testing. |
| Market data (upgrade path) | Alpaca Algo Trader Plus (full SIP) or Polygon.io Stocks Advanced | Add only when a strategy needs full-tape data. Keep data access behind an interface so the vendor can change. |
| Data / compute | `pandas`, `numpy` | |
| Indicators | `pandas-ta` | TA-Lib optional (C dependency). |
| Backtesting | `vectorbt` or `backtrader` | Pick one; both integrate with Alpaca data. |
| Desktop UI | **PySide6** (Qt) | Native macOS/Linux. Build in a later phase. |
| Charts | TradingView Lightweight Charts (embedded) | |
| Persistence | SQLite (via `sqlalchemy`) | Local file DB; sufficient for one user. |
| Config | `pydantic-settings` + `.env` | Typed config, env-driven. |
| Logging | `structlog` or stdlib `logging` (JSON) | Structured logs to file + console. |
| Testing | `pytest` | |
| Packaging | `pip` + `pyproject.toml`; virtualenv | Consider `briefcase`/`pyinstaller` for distributable app in a later phase. |

---

## 4. Architecture

Left-to-right pipeline with the Risk Layer as a mandatory gate:

```
Desktop UI (PySide6) ── monitors/controls ──┐
                                             ▼
Market Data ──▶ Strategy Engine ──▶ Risk Layer ──▶ Broker API ──▶ Broker/Exchange
     │                │                  │              │
     └────────────────┴──────────────────┴──────────────┘
                          ▼
                 Persistence & Logging  (every signal, order, fill, rejection)
```

Key principle: the **same strategy code** runs against three data sources behind one interface — historical (backtest), simulated (paper), live — selected by config. Promoting a strategy through stages must require no strategy rewrites.

---

## 5. Proposed repository structure

```
trading-app/
├── pyproject.toml
├── .env.example
├── .gitignore                # must ignore .env, *.db, logs/
├── README.md
├── CLAUDE.md                 # coding conventions (see §10)
├── config/
│   └── settings.py           # pydantic-settings; loads .env
├── src/
│   └── trading/
│       ├── __init__.py
│       ├── core/
│       │   ├── models.py     # dataclasses: Bar, Quote, Order, Fill, Position, Signal
│       │   └── events.py     # event types for the engine loop
│       ├── data/
│       │   ├── base.py       # MarketDataProvider (abstract)
│       │   ├── alpaca.py     # AlpacaDataProvider
│       │   └── historical.py # CSV/DB replay provider for backtests
│       ├── broker/
│       │   ├── base.py       # Broker (abstract): submit_order, cancel, positions, account
│       │   ├── alpaca.py     # AlpacaBroker
│       │   └── paper_sim.py  # optional local fill simulator for backtests
│       ├── strategy/
│       │   ├── base.py       # Strategy (abstract): on_bar, on_quote -> Signal | None
│       │   └── examples/
│       │       └── ma_crossover.py
│       ├── risk/
│       │   └── risk_layer.py # THE chokepoint (§6.5)
│       ├── engine/
│       │   └── engine.py     # event loop; wires data -> strategy -> risk -> broker
│       ├── persistence/
│       │   ├── db.py         # sqlalchemy engine/session
│       │   └── repositories.py
│       ├── backtest/
│       │   └── runner.py
│       └── ui/               # phase 5
│           └── app.py
└── tests/
    ├── test_risk_layer.py    # highest-priority tests
    ├── test_engine.py
    └── test_strategy.py
```

---

## 6. Component specifications

### 6.1 Config (`config/settings.py`)
- Typed settings via `pydantic-settings`, sourced from env/`.env`.
- Fields: `mode` (`backtest|paper|live`), broker keys, data keys, `allow_live_trading` (bool, from `ALLOW_LIVE_TRADING`), risk limits (see §6.5), DB path, log level.
- On load: if `mode == "live"` and not `allow_live_trading`, raise and exit.

### 6.2 Core models (`core/models.py`)
Immutable dataclasses: `Bar(symbol, ts, open, high, low, close, volume)`, `Quote(symbol, ts, bid, ask, bid_size, ask_size)`, `Signal(symbol, side, qty, type, limit_price?, reason)`, `Order(...)`, `Fill(...)`, `Position(symbol, qty, avg_price, unrealized_pnl)`, `Account(equity, buying_power, cash)`. Use `Decimal` for prices/quantities, not float.

### 6.3 Market data interface (`data/base.py`)
Abstract `MarketDataProvider` with: `get_historical_bars(symbols, start, end, timeframe) -> list[Bar]`, `stream_quotes(symbols, callback)`, `stream_bars(symbols, timeframe, callback)`. Implementations: `AlpacaDataProvider` (live/historical via `alpaca-py`), `HistoricalReplayProvider` (replays stored bars for backtests through the same callback contract).

### 6.4 Broker interface (`broker/base.py`)
Abstract `Broker` with: `get_account() -> Account`, `get_positions() -> list[Position]`, `submit_order(order) -> Order`, `cancel_order(order_id)`, `get_orders(status)`, and support for **attaching a server-side stop** (bracket/OTO order). `AlpacaBroker` implements via `alpaca-py`. **The engine must never call `broker.submit_order` directly — only the Risk Layer does.**

### 6.5 Risk Layer (`risk/risk_layer.py`) — most important component

A single class `RiskLayer` is the *only* thing permitted to call `broker.submit_order`. The engine hands it `Signal`s; it converts them to `Order`s only if every check passes, otherwise it rejects and logs.

Mandatory checks (all configurable):
- **Max position size per symbol** (shares and/or notional).
- **Max total gross exposure** across all positions.
- **Daily loss limit:** track realized+unrealized P&L vs. start-of-day equity; if breached, set a halt flag that blocks all new entries (exits still allowed).
- **Order sanity check:** reject orders whose notional exceeds a hard ceiling, or whose quantity is non-positive, or that would exceed buying power — catches runaway loops / fat-finger bugs.
- **Rate limit:** cap orders-per-minute; reject bursts.
- **Kill switch:** a flag (settable from UI/CLI) that, when on, blocks all new orders and optionally flattens positions.
- **Attach protective stop:** entries should submit with a server-side stop attached (bracket order).

API sketch:
```python
class RiskLayer:
    def __init__(self, broker: Broker, limits: RiskLimits, repo: Repository): ...
    def submit(self, signal: Signal) -> RiskDecision:
        # 1. run all checks; 2. log decision; 3. if approved, submit via broker
        # returns RiskDecision(approved: bool, order: Order | None, reason: str)
    def engage_kill_switch(self) -> None: ...
    def reset_daily(self) -> None: ...
```
Write `tests/test_risk_layer.py` **first and thoroughly** — each limit gets a pass case and a reject case.

### 6.6 Persistence & logging (`persistence/`)
SQLite via SQLAlchemy. Tables: `signals`, `orders`, `fills`, `risk_decisions`, `equity_snapshots`. Every engine action writes a row. Structured JSON logs to `logs/` in addition to the DB.

### 6.7 Strategy interface (`strategy/base.py`)
Abstract `Strategy` with `on_bar(bar, context) -> Signal | None` and optional `on_quote(...)`. `context` exposes current positions, account, and indicator history. Ship one example: `ma_crossover.py` (e.g. fast/slow SMA crossover). Strategies are pure signal generators — they must **not** touch the broker directly.

### 6.8 Engine (`engine/engine.py`)
Event loop that: subscribes to the data provider, feeds events to the active strategy, passes returned `Signal`s to the `RiskLayer`, reconciles broker fills/positions, and persists everything. Must handle: partial fills, order rejections, websocket disconnect + reconnect with backoff, market open/close and session boundaries, and graceful shutdown that does not orphan positions. The same engine runs all three modes; only the injected data provider + broker differ.

### 6.9 Backtest runner (`backtest/runner.py`)
Wires `HistoricalReplayProvider` + a fill-simulator broker into the same engine, runs a strategy over a date range, and reports metrics (total return, max drawdown, win rate, Sharpe, trade count). Optionally delegate metrics to `vectorbt`.

### 6.10 UI (`ui/app.py`) — phase 5 only
PySide6 window: live positions + P&L table, equity curve (Lightweight Charts), scrolling log view, mode indicator, and a prominent **kill-switch button** wired to `RiskLayer.engage_kill_switch()`.

---

## 7. Build phases (do in order; meet acceptance criteria before advancing)

**Phase 1 — Plumbing.** Project scaffold, config, models, `AlpacaDataProvider`, `AlpacaBroker` against **paper**. 
*Acceptance:* fetch historical bars, stream live quotes to console, read paper account + positions.

**Phase 2 — Backtest harness.** `HistoricalReplayProvider`, fill simulator, engine skeleton, `ma_crossover` strategy, metrics. 
*Acceptance:* run the example strategy over historical data and print a metrics report.

**Phase 3 — Engine + Risk Layer.** Full event loop, `RiskLayer` with all checks + tests, persistence. Orders go to **paper** only. 
*Acceptance:* `test_risk_layer.py` passes; engine places risk-checked paper orders with server-side stops; all actions logged to DB.

**Phase 4 — Paper trading hardening.** Run live against paper for an extended period; handle partial fills, rejections, reconnects, session boundaries, crash recovery. 
*Acceptance:* engine runs a full trading day on paper without manual intervention and recovers cleanly from a forced disconnect.

**Phase 5 — Desktop UI.** PySide6 monitoring + kill switch on top of the working engine. 
*Acceptance:* UI shows live positions/P&L/logs and the kill switch halts trading.

**Phase 6 — Live (human-gated).** Only after Phase 4 is stable. Smallest possible real size. **CONFIRM with human; require `mode=live` + `ALLOW_LIVE_TRADING=1`.**

---

## 8. Testing requirements
- `test_risk_layer.py` is the priority suite: a pass + reject case per limit, plus kill-switch and daily-loss-halt behavior.
- Engine tests use the historical/sim providers (no network).
- No test may hit a live account. Paper/mocked only.

## 9. Open decisions to CONFIRM with the human
1. Broker for go-live (Alpaca vs IBKR) and whether their broker has adopted the post-PDT margin framework yet.
2. Market-data tier (start free IEX; upgrade trigger).
3. Strategy timeframe (minute bars vs. finer) — affects data costs and engine design.
4. Single-symbol vs. multi-symbol universe at launch.

## 10. Coding conventions (consider moving to `CLAUDE.md`)
- Type hints everywhere; `Decimal` for money/quantities.
- No secrets in code; `.env` git-ignored; `.env.example` maintained.
- Every broker submission goes through `RiskLayer`; enforce by design.
- Small, testable modules; dependency-inject providers/brokers so modes swap cleanly.
- Fail safe: on ambiguity, stop trading and log — never blind-retry order submission.
- Conventional commits; run `pytest` before considering a phase complete.
