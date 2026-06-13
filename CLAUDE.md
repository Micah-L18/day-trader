# CLAUDE.md — coding conventions & architecture invariants

Guidance for working in this repo (BUILD_PLAN §10). Read `BUILD_PLAN.md` for the
full spec; this file is the day-to-day contract.

## Non-negotiable invariants

1. **Every broker submission goes through `RiskLayer.submit`.** The engine,
   strategies, and UI must never call `broker.submit_order`. It is enforced at
   runtime: `submit_order` raises `ChokepointError` unless it runs inside the
   `trading.broker.base.risk_approval()` context, which only the risk layer
   enters. Do not weaken this.
2. **Live trading is double-gated.** `mode=live` **and** `ALLOW_LIVE_TRADING=1`
   are both required; the settings loader raises otherwise. Never add a code path
   that reaches a live account with only one signal set.
3. **Protective stops are server-side.** Entries carry `stop_loss_price`; the
   broker attaches a bracket/OTO. Don't hold stops only in-app.
4. **Fail safe, not open.** On ambiguity (disconnect, unknown order state, no
   reference price) the default is to stop/refuse and log — never blind-retry a
   submission.
5. **Persist everything.** Signals, orders, fills, risk decisions and equity
   snapshots are written to SQLite. New trading actions get a row.

## Style

- **Type hints everywhere.** `mypy` runs clean (`disallow_untyped_defs`). Keep it
  that way.
- **`Decimal` for all money and quantities — never `float`.** Use
  `trading.core.models.to_decimal` to coerce inputs. Models are frozen
  dataclasses; produce copies with `Order.with_updates(...)`.
- **Vendor isolation.** Only `*/alpaca.py` adapters import `alpaca`. They are
  lazy-imported (optional `[alpaca]` extra) and translate to/from
  `trading.core.models` at the boundary. The rest of the app stays vendor-neutral.
- **Dependency injection.** Providers/brokers/repos are injected so modes swap
  cleanly. Prefer small, testable modules.
- **Strategies are pure.** They return `Signal | None` from market data + a
  read-only `StrategyContext`. No broker access, no shared mutation.
- **Conventional Commits** for commit messages.

## Dev workflow

```bash
pip install -e ".[dev]"
pytest                 # must pass before a phase is "done"
ruff check src tests   # lint (auto-fix: ruff check --fix)
mypy                   # type-check
```

## Testing rules

- **No test may hit a live account or the network.** Use the simulated broker
  (`SimulatedBroker`), the replay provider (`HistoricalReplayProvider`), or the
  `FakeBroker` fixture. Network-touching tests must be marked `@pytest.mark.network`
  (skipped by default).
- `tests/test_risk_layer.py` is the priority suite: each limit gets a pass case
  and a reject case, plus kill switch and daily-loss-halt behaviour. When you add
  or change a risk check, add both cases.

## Layout

```
src/trading/
  config/      settings (live gate, risk limits)
  core/        models, events, logging
  data/        market-data providers (base, alpaca, historical replay)
  broker/      brokers (base + chokepoint guard, alpaca, paper_sim)
  strategy/    strategy base + examples/
  risk/        risk_layer.py  ← the chokepoint
  engine/      engine.py      ← one loop, three modes
  persistence/ db.py, repositories.py
  backtest/    runner.py, synthetic.py
  ui/          app.py (Phase 5)
  cli.py, factory.py
tests/
```
