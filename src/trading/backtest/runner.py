"""Backtest runner + metrics (BUILD_PLAN §6.9).

Wires a :class:`~trading.data.historical.HistoricalReplayProvider` and the
:class:`~trading.broker.paper_sim.SimulatedBroker` into the *same* engine the
live system uses, runs a strategy over the supplied bars and reports metrics:
total return, max drawdown, Sharpe, win rate and trade count.

Metrics are computed in-house from the persisted equity curve and fills, so the
runner has no heavy third-party dependency. (``vectorbt`` can be slotted in later
for richer analytics -- the ``backtest`` extra.)
"""

from __future__ import annotations

import itertools
import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from trading.broker.paper_sim import SimulatedBroker
from trading.config.settings import RiskLimits
from trading.core.models import Bar, Fill
from trading.data.historical import HistoricalReplayProvider
from trading.engine.engine import Engine
from trading.persistence.db import Database
from trading.persistence.repositories import SqlRepository
from trading.risk.risk_layer import RiskLayer
from trading.strategy.base import Strategy

# Rough bars-per-year used to annualise Sharpe, keyed by timeframe token.
_TRADING_DAYS = 252
_MINUTES_PER_SESSION = 390


@dataclass(frozen=True)
class Trade:
    """A realised round-trip (or partial close) with its P&L."""

    symbol: str
    qty: Decimal
    entry_price: Decimal
    exit_price: Decimal
    pnl: Decimal
    exit_ts: datetime


@dataclass
class BacktestResult:
    starting_equity: Decimal
    final_equity: Decimal
    total_return: Decimal
    max_drawdown: Decimal
    sharpe: float
    win_rate: float
    trade_count: int
    num_bars: int
    equity_curve: list[tuple[datetime, Decimal]] = field(default_factory=list)
    trades: list[Trade] = field(default_factory=list)

    def report(self) -> str:
        pct = lambda d: f"{float(d) * 100:.2f}%"  # noqa: E731
        lines = [
            "================ Backtest Report ================",
            f" Bars processed : {self.num_bars}",
            f" Starting equity: {self.starting_equity:,.2f}",
            f" Final equity   : {self.final_equity:,.2f}",
            f" Total return   : {pct(self.total_return)}",
            f" Max drawdown   : {pct(self.max_drawdown)}",
            f" Sharpe (ann.)  : {self.sharpe:.2f}",
            f" Win rate       : {self.win_rate * 100:.1f}%",
            f" Trades (closes): {self.trade_count}",
            "=================================================",
        ]
        return "\n".join(lines)


class BacktestRunner:
    """Runs a strategy over historical bars and reports metrics."""

    def __init__(
        self,
        strategy: Strategy,
        bars: Iterable[Bar],
        *,
        symbols: Sequence[str] | None = None,
        timeframe: str = "1Min",
        starting_cash: Decimal | float | str = Decimal("100000"),
        limits: RiskLimits | None = None,
        slippage_pct: Decimal | float | str = Decimal("0"),
        fee_per_share: Decimal | float | str = Decimal("0"),
    ) -> None:
        self.strategy = strategy
        self.bars = list(bars)
        self.symbols = list(symbols) if symbols else sorted({b.symbol for b in self.bars})
        self.timeframe = timeframe
        self.starting_cash = Decimal(str(starting_cash))
        self.limits = limits or RiskLimits()
        self.slippage_pct = slippage_pct
        self.fee_per_share = fee_per_share

    def run(self) -> BacktestResult:
        db = Database.in_memory()
        repo = SqlRepository(db)
        broker = SimulatedBroker(
            self.starting_cash,
            slippage_pct=self.slippage_pct,
            fee_per_share=self.fee_per_share,
        )
        data = HistoricalReplayProvider.from_bars(self.bars)
        risk = RiskLayer(broker, self.limits, repo)
        engine = Engine(
            strategy=self.strategy,
            risk=risk,
            broker=broker,
            data=data,
            symbols=self.symbols,
            timeframe=self.timeframe,
            repo=repo,
        )
        engine.run_backtest()

        equity_curve = repo.equity_curve()
        fills = repo.all_fills()
        result = self._compute_metrics(equity_curve, fills, num_bars=len(self.bars))
        db.dispose()
        return result

    # -- metrics -----------------------------------------------------------
    def _compute_metrics(
        self,
        equity_curve: list[tuple[datetime, Decimal]],
        fills: list[Fill],
        *,
        num_bars: int,
    ) -> BacktestResult:
        start = self.starting_cash
        final = equity_curve[-1][1] if equity_curve else start
        total_return = (final - start) / start if start else Decimal(0)

        max_dd = _max_drawdown([e for _, e in equity_curve])
        sharpe = _sharpe([e for _, e in equity_curve], self._periods_per_year())
        trades = _reconstruct_trades(fills)
        wins = sum(1 for t in trades if t.pnl > 0)
        win_rate = (wins / len(trades)) if trades else 0.0

        return BacktestResult(
            starting_equity=start,
            final_equity=final,
            total_return=total_return,
            max_drawdown=max_dd,
            sharpe=sharpe,
            win_rate=win_rate,
            trade_count=len(trades),
            num_bars=num_bars,
            equity_curve=equity_curve,
            trades=trades,
        )

    def _periods_per_year(self) -> float:
        tf = self.timeframe.lower()
        if "day" in tf:
            return float(_TRADING_DAYS)
        if "hour" in tf:
            return float(_TRADING_DAYS) * 6.5
        if "min" in tf:
            # crude: amount * minute
            digits = "".join(c for c in tf if c.isdigit())
            n = int(digits) if digits else 1
            return float(_TRADING_DAYS) * (_MINUTES_PER_SESSION / max(n, 1))
        return float(_TRADING_DAYS)


def _max_drawdown(equity: Sequence[Decimal]) -> Decimal:
    if not equity:
        return Decimal(0)
    peak = equity[0]
    max_dd = Decimal(0)
    for value in equity:
        if value > peak:
            peak = value
        if peak > 0:
            dd = (peak - value) / peak
            if dd > max_dd:
                max_dd = dd
    return max_dd


def _sharpe(equity: Sequence[Decimal], periods_per_year: float) -> float:
    if len(equity) < 3:
        return 0.0
    rets: list[float] = []
    for prev, cur in itertools.pairwise(equity):
        if prev != 0:
            rets.append(float((cur - prev) / prev))
    if len(rets) < 2:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    return (mean / std) * math.sqrt(periods_per_year)


def _reconstruct_trades(fills: Iterable[Fill]) -> list[Trade]:
    """Walk fills per symbol, recording realised P&L on each closing event."""
    qty: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    avg: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    trades: list[Trade] = []

    for fill in fills:
        sym = fill.symbol
        signed = fill.qty * Decimal(fill.side.sign)
        cur_qty = qty[sym]
        if cur_qty != 0 and (cur_qty > 0) != (signed > 0):
            closing = min(abs(signed), abs(cur_qty))
            direction = Decimal(1) if cur_qty > 0 else Decimal(-1)
            pnl = closing * (fill.price - avg[sym]) * direction
            trades.append(
                Trade(
                    symbol=sym,
                    qty=closing,
                    entry_price=avg[sym],
                    exit_price=fill.price,
                    pnl=pnl,
                    exit_ts=fill.ts,
                )
            )
            new_qty = cur_qty + signed
            if abs(signed) > abs(cur_qty):  # flipped
                qty[sym] = new_qty
                avg[sym] = fill.price
            else:
                qty[sym] = new_qty
                if new_qty == 0:
                    avg[sym] = Decimal(0)
        else:
            total_cost = avg[sym] * abs(cur_qty) + fill.price * fill.qty
            new_qty = cur_qty + signed
            qty[sym] = new_qty
            avg[sym] = total_cost / abs(new_qty) if new_qty != 0 else Decimal(0)

    return trades


__all__ = ["BacktestResult", "BacktestRunner", "Trade"]
