"""Command-line entry point (``trader ...``).

Subcommands map onto the build-plan acceptance criteria:

* ``account``  -- read paper account + positions          (Phase 1)
* ``bars``     -- fetch historical bars                    (Phase 1)
* ``stream``   -- stream live quotes/bars to the console   (Phase 1)
* ``backtest`` -- run the example strategy + metrics       (Phase 2)
* ``run``      -- run the engine live against **paper**    (Phase 3/4)

Live trading is never reachable here without ``mode=live`` *and*
``ALLOW_LIVE_TRADING=1`` -- the settings loader enforces that.
"""

from __future__ import annotations

import argparse
import signal
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from trading.config.settings import Settings, get_settings
from trading.core.logging_setup import configure_logging, get_logger

log = get_logger("cli")


def _configure(settings: Settings) -> None:
    configure_logging(
        level=settings.log_level,
        log_dir=settings.log_dir,
        json_logs=settings.log_json,
    )


# ---------------------------------------------------------------------------
# Phase 1 commands (require Alpaca credentials + the alpaca extra)
# ---------------------------------------------------------------------------
def cmd_account(settings: Settings, args: argparse.Namespace) -> int:
    from trading.factory import build_broker

    broker = build_broker(settings)
    account = broker.get_account()
    print(f"Mode        : {settings.mode.value}")
    print(f"Equity      : {account.equity:,.2f}")
    print(f"Cash        : {account.cash:,.2f}")
    print(f"Buying power: {account.buying_power:,.2f}")
    positions = broker.get_positions()
    print(f"\nPositions ({len(positions)}):")
    for p in positions:
        print(f"  {p.symbol:6} qty={p.qty} avg={p.avg_price} uPnL={p.unrealized_pnl}")
    return 0


def cmd_bars(settings: Settings, args: argparse.Namespace) -> int:
    from trading.factory import build_data_provider

    provider = build_data_provider(settings)
    end = datetime.now(UTC)
    start = end - timedelta(days=args.days)
    symbols = args.symbols or settings.symbols
    bars = provider.get_historical_bars(symbols, start, end, args.timeframe)
    print(f"Fetched {len(bars)} bars for {symbols} ({args.timeframe})")
    for b in bars[-args.tail :]:
        print(
            f"  {b.symbol:6} {b.ts.isoformat()} "
            f"O={b.open} H={b.high} L={b.low} C={b.close} V={b.volume}"
        )
    return 0


def cmd_stream(settings: Settings, args: argparse.Namespace) -> int:
    from trading.factory import build_data_provider

    provider = build_data_provider(settings)
    symbols = args.symbols or settings.symbols

    if args.bars:
        provider.stream_bars(
            symbols, args.timeframe, lambda b: print(f"BAR  {b.symbol} {b.ts} C={b.close}")
        )
    else:
        provider.stream_quotes(
            symbols, lambda q: print(f"QUOTE {q.symbol} {q.ts} bid={q.bid} ask={q.ask}")
        )

    print(f"Streaming {'bars' if args.bars else 'quotes'} for {symbols} -- Ctrl-C to stop")
    try:
        provider.start()
        signal.pause()
    except KeyboardInterrupt:
        pass
    finally:
        provider.stop()
    return 0


# ---------------------------------------------------------------------------
# Phase 2 command (offline-capable)
# ---------------------------------------------------------------------------
def cmd_backtest(settings: Settings, args: argparse.Namespace) -> int:
    from trading.backtest.runner import BacktestRunner
    from trading.backtest.synthetic import oscillating_bars
    from trading.data.historical import HistoricalReplayProvider
    from trading.strategy.examples.ma_crossover import MaCrossoverStrategy

    symbols = args.symbols or settings.symbols

    if args.csv:
        provider = HistoricalReplayProvider.from_csv(args.csv, timeframe=args.timeframe)
        bars = list(provider.iter_bars(symbols))
        if not bars:
            print(f"No bars for {symbols} found in {args.csv}", file=sys.stderr)
            return 1
    else:
        bars = []
        for i, sym in enumerate(symbols):
            bars.extend(
                oscillating_bars(sym, args.periods, base=100 + i * 25, timeframe=args.timeframe)
            )
        print(f"(demo) generated {len(bars)} synthetic bars for {symbols}")

    strategy = MaCrossoverStrategy(symbols, fast=args.fast, slow=args.slow, qty=args.qty)
    runner = BacktestRunner(
        strategy,
        bars,
        symbols=symbols,
        timeframe=args.timeframe,
        starting_cash=Decimal(str(args.cash)),
        slippage_pct=Decimal(str(args.slippage)),
    )
    result = runner.run()
    print(result.report())
    return 0


# ---------------------------------------------------------------------------
# Phase 3/4 command -- run live against paper
# ---------------------------------------------------------------------------
def cmd_run(settings: Settings, args: argparse.Namespace) -> int:
    from trading.factory import build_engine
    from trading.strategy.examples.ma_crossover import MaCrossoverStrategy

    if settings.is_backtest:
        print("mode=backtest cannot 'run' live; use the backtest command.", file=sys.stderr)
        return 2

    strategy = MaCrossoverStrategy(settings.symbols, fast=args.fast, slow=args.slow, qty=args.qty)
    engine, db = build_engine(settings, strategy)

    def _handle_sigint(_signum: int, _frame: object) -> None:
        log.warning("sigint_received_shutting_down")
        engine.stop("sigint")

    signal.signal(signal.SIGINT, _handle_sigint)
    print(f"Running {settings.mode.value} engine for {settings.symbols} -- Ctrl-C to stop")
    try:
        engine.run_live()
    finally:
        db.dispose()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="trader", description="Day-trading engine CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("account", help="show paper account & positions")

    p_bars = sub.add_parser("bars", help="fetch historical bars")
    p_bars.add_argument("--symbols", nargs="*")
    p_bars.add_argument("--days", type=int, default=5)
    p_bars.add_argument("--timeframe", default="1Min")
    p_bars.add_argument("--tail", type=int, default=10)

    p_stream = sub.add_parser("stream", help="stream live quotes/bars to console")
    p_stream.add_argument("--symbols", nargs="*")
    p_stream.add_argument("--bars", action="store_true", help="stream bars instead of quotes")
    p_stream.add_argument("--timeframe", default="1Min")

    p_bt = sub.add_parser("backtest", help="run the example strategy over data")
    p_bt.add_argument("--symbols", nargs="*")
    p_bt.add_argument("--csv", help="CSV file of bars (symbol,ts,open,high,low,close,volume)")
    p_bt.add_argument("--periods", type=int, default=500, help="demo bars per symbol")
    p_bt.add_argument("--seed", type=int, default=0)
    p_bt.add_argument("--fast", type=int, default=10)
    p_bt.add_argument("--slow", type=int, default=30)
    p_bt.add_argument("--qty", type=int, default=10)
    p_bt.add_argument("--cash", type=float, default=100000)
    p_bt.add_argument("--slippage", type=float, default=0.0)
    p_bt.add_argument("--timeframe", default="1Min")

    p_run = sub.add_parser("run", help="run the engine live (paper)")
    p_run.add_argument("--fast", type=int, default=10)
    p_run.add_argument("--slow", type=int, default=30)
    p_run.add_argument("--qty", type=int, default=10)

    return parser


_COMMANDS = {
    "account": cmd_account,
    "bars": cmd_bars,
    "stream": cmd_stream,
    "backtest": cmd_backtest,
    "run": cmd_run,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = get_settings()
    except Exception as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    _configure(settings)
    handler = _COMMANDS[args.command]
    try:
        return handler(settings, args)
    except Exception as exc:  # pragma: no cover - top-level guard
        log.error("command_failed", command=args.command, error=str(exc))
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
