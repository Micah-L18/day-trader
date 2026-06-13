"""MA-crossover strategy tests (BUILD_PLAN §6.7, §8)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from trading.backtest.synthetic import trending_bars
from trading.core.models import Position, Side
from trading.strategy.base import StrategyContext
from trading.strategy.examples.ma_crossover import MaCrossoverStrategy


def _flat_context() -> StrategyContext:
    return StrategyContext(positions={})


def _long_context(symbol: str = "AAPL", qty: int = 10) -> StrategyContext:
    pos = Position(symbol, Decimal(qty), Decimal("100"), current_price=Decimal("100"))
    return StrategyContext(positions={symbol: pos})


def test_fast_must_be_smaller_than_slow() -> None:
    with pytest.raises(ValueError):
        MaCrossoverStrategy(["AAPL"], fast=30, slow=10)


def test_no_signal_during_warmup() -> None:
    strat = MaCrossoverStrategy(["AAPL"], fast=3, slow=8)
    bars = trending_bars("AAPL", 30, swing=0.01)
    signals = [strat.on_bar(b, _flat_context()) for b in bars[:7]]
    assert all(s is None for s in signals)  # < slow bars seen


def test_golden_cross_emits_buy_when_flat() -> None:
    strat = MaCrossoverStrategy(["AAPL"], fast=3, slow=8, qty=5)
    bars = trending_bars("AAPL", 90, swing=0.01)
    buys = [s for b in bars if (s := strat.on_bar(b, _flat_context())) and s.side is Side.BUY]
    assert buys, "expected at least one golden-cross BUY"
    assert buys[0].qty == Decimal("5")


def test_death_cross_emits_sell_when_long() -> None:
    strat = MaCrossoverStrategy(["AAPL"], fast=3, slow=8, qty=5)
    bars = trending_bars("AAPL", 90, swing=0.01)
    # Hold a long throughout so only the death-cross SELL path can fire.
    sells = [s for b in bars if (s := strat.on_bar(b, _long_context())) and s.side is Side.SELL]
    assert sells, "expected a death-cross SELL while long"
    # SELL flattens the whole position.
    assert sells[0].qty == Decimal("10")


def test_ignores_symbols_outside_universe() -> None:
    strat = MaCrossoverStrategy(["AAPL"], fast=3, slow=8)
    bars = trending_bars("TSLA", 50)
    assert all(strat.on_bar(b, _flat_context()) is None for b in bars)
