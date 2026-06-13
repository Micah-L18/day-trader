"""Abstract strategy interface (BUILD_PLAN §6.7).

Strategies are **pure signal generators**. They look at market data plus a
read-only :class:`StrategyContext` (current positions + account) and return a
:class:`~trading.core.models.Signal` or ``None``. They never touch a broker,
never submit orders, and never mutate shared state -- the engine and risk layer
own those responsibilities. This is what lets the same strategy run unchanged in
backtest, paper and live.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal

from trading.core.models import Account, Bar, Position, Quote, Signal


@dataclass(frozen=True)
class StrategyContext:
    """Read-only snapshot handed to a strategy on each event."""

    account: Account | None = None
    positions: Mapping[str, Position] = field(default_factory=dict)

    def position(self, symbol: str) -> Position | None:
        return self.positions.get(symbol)

    def qty(self, symbol: str) -> Decimal:
        pos = self.positions.get(symbol)
        return pos.qty if pos is not None else Decimal(0)

    def is_long(self, symbol: str) -> bool:
        return self.qty(symbol) > 0

    def is_flat(self, symbol: str) -> bool:
        return self.qty(symbol) == 0


class Strategy(ABC):
    """Base class for trading strategies."""

    def __init__(self, symbols: Sequence[str], strategy_id: str | None = None) -> None:
        self.symbols = [s.upper() for s in symbols]
        self.strategy_id = strategy_id or self.__class__.__name__

    @abstractmethod
    def on_bar(self, bar: Bar, context: StrategyContext) -> Signal | None:
        """React to a completed bar. Return a :class:`Signal` or ``None``."""

    def on_quote(self, quote: Quote, context: StrategyContext) -> Signal | None:
        """React to a quote. Default: ignore (bar-driven strategies)."""
        return None

    def on_start(self) -> None:
        """Called once before the run begins (e.g. to warm up indicators)."""
        return None

    def on_stop(self) -> None:
        """Called once after the run ends."""
        return None

    def _tag(self, signal: Signal) -> Signal:
        """Stamp a signal with this strategy's id (engine calls aren't required to)."""
        if signal.strategy_id:
            return signal
        from dataclasses import replace

        return replace(signal, strategy_id=self.strategy_id)
