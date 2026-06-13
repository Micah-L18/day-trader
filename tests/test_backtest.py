"""Backtest runner + metrics tests (BUILD_PLAN §6.9, §8)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from trading.backtest.runner import (
    BacktestRunner,
    _max_drawdown,
    _reconstruct_trades,
    _sharpe,
)
from trading.backtest.synthetic import oscillating_bars
from trading.core.models import Fill, Side
from trading.strategy.examples.ma_crossover import MaCrossoverStrategy


def test_runner_produces_report_and_trades() -> None:
    bars = oscillating_bars("AAPL", 400, amplitude=0.05, wavelength=80)
    strat = MaCrossoverStrategy(["AAPL"], fast=5, slow=20, qty=10)
    result = BacktestRunner(strat, bars, symbols=["AAPL"], timeframe="1Min").run()

    assert result.num_bars == 400
    assert result.trade_count > 0
    assert 0.0 <= result.win_rate <= 1.0
    assert "Backtest Report" in result.report()
    assert result.equity_curve  # snapshots recorded


def test_runner_is_deterministic() -> None:
    bars = oscillating_bars("AAPL", 300)
    a = BacktestRunner(MaCrossoverStrategy(["AAPL"], fast=5, slow=20), bars, symbols=["AAPL"]).run()
    b = BacktestRunner(MaCrossoverStrategy(["AAPL"], fast=5, slow=20), bars, symbols=["AAPL"]).run()
    assert a.final_equity == b.final_equity
    assert a.trade_count == b.trade_count


def test_max_drawdown() -> None:
    curve = [Decimal("100"), Decimal("120"), Decimal("90"), Decimal("110")]
    assert _max_drawdown(curve) == Decimal("0.25")
    assert _max_drawdown([Decimal("100"), Decimal("110")]) == Decimal("0")


def test_sharpe_zero_for_flat_curve() -> None:
    assert _sharpe([Decimal("100")] * 10, 252) == 0.0


def test_reconstruct_trades_pairs_round_trip() -> None:
    ts = datetime(2024, 1, 2, tzinfo=UTC)
    fills = [
        Fill(order_id="1", symbol="AAPL", side=Side.BUY, qty=Decimal("10"),
             price=Decimal("100"), ts=ts),
        Fill(order_id="2", symbol="AAPL", side=Side.SELL, qty=Decimal("10"),
             price=Decimal("110"), ts=ts),
    ]
    trades = _reconstruct_trades(fills)
    assert len(trades) == 1
    assert trades[0].pnl == Decimal("100")  # (110-100)*10
