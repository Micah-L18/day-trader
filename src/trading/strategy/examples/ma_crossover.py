"""Moving-average crossover example strategy (BUILD_PLAN §6.7).

Long-only demonstration: go long when the fast SMA crosses *above* the slow SMA
(golden cross) and flatten when it crosses *below* (death cross). Implemented
with a plain rolling window so it has no third-party indicator dependency; richer
strategies can use ``pandas-ta`` (the ``indicators`` extra).

This strategy is intentionally simple. It exists to exercise the pipeline, not to
make money -- per the build plan, edge comes from strategy research, not the
plumbing.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence
from decimal import Decimal

from trading.core.models import Bar, OrderType, Side, Signal
from trading.strategy.base import Strategy, StrategyContext


class MaCrossoverStrategy(Strategy):
    """Fast/slow simple-moving-average crossover, one position per symbol."""

    def __init__(
        self,
        symbols: Sequence[str],
        *,
        fast: int = 10,
        slow: int = 30,
        qty: Decimal | int = 10,
        strategy_id: str | None = None,
    ) -> None:
        super().__init__(symbols, strategy_id)
        if fast >= slow:
            raise ValueError("fast period must be smaller than slow period")
        self.fast = fast
        self.slow = slow
        self.qty = Decimal(str(qty))
        # Per-symbol rolling close windows + previous SMA relationship.
        self._closes: dict[str, deque[Decimal]] = {
            s: deque(maxlen=slow) for s in self.symbols
        }
        self._prev_diff: dict[str, Decimal | None] = dict.fromkeys(self.symbols)

    def on_bar(self, bar: Bar, context: StrategyContext) -> Signal | None:
        symbol = bar.symbol.upper()
        if symbol not in self._closes:
            # Not in this strategy's universe.
            return None

        window = self._closes[symbol]
        window.append(bar.close)
        if len(window) < self.slow:
            return None  # not enough history yet

        fast_sma = self._sma(window, self.fast)
        slow_sma = self._sma(window, self.slow)
        diff = fast_sma - slow_sma
        prev = self._prev_diff[symbol]
        self._prev_diff[symbol] = diff

        if prev is None:
            return None  # need a previous value to detect a crossing

        crossed_up = prev <= 0 and diff > 0
        crossed_down = prev >= 0 and diff < 0
        is_long = context.is_long(symbol)

        if crossed_up and not is_long:
            return self._tag(
                Signal(
                    symbol=symbol,
                    side=Side.BUY,
                    qty=self.qty,
                    type=OrderType.MARKET,
                    reason=f"golden_cross fast({self.fast})>{slow_sma:.4f} slow({self.slow})",
                )
            )
        if crossed_down and is_long:
            return self._tag(
                Signal(
                    symbol=symbol,
                    side=Side.SELL,
                    qty=context.qty(symbol),  # flatten the whole position
                    type=OrderType.MARKET,
                    reason=f"death_cross fast({self.fast})<{slow_sma:.4f} slow({self.slow})",
                )
            )
        return None

    @staticmethod
    def _sma(window: deque[Decimal], period: int) -> Decimal:
        # Average of the most recent ``period`` closes.
        recent = list(window)[-period:]
        return sum(recent, Decimal(0)) / Decimal(len(recent))
