"""Deterministic synthetic bar generator for offline demos and tests.

Produces a reproducible random-walk OHLCV series so the backtest harness can be
exercised without any market-data access. NOT for any analytical use -- it is
fake data to validate plumbing.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from trading.core.models import Bar


def _bar(symbol: str, ts: datetime, prev: float, price: float, timeframe: str) -> Bar:
    return Bar.create(
        symbol=symbol,
        ts=ts,
        open=round(prev, 2),
        high=round(max(prev, price) * 1.001, 2),
        low=round(min(prev, price) * 0.999, 2),
        close=round(price, 2),
        volume=10000,
        timeframe=timeframe,
    )


def random_walk_bars(
    symbol: str,
    periods: int,
    *,
    start: datetime | None = None,
    start_price: float = 100.0,
    step: timedelta = timedelta(minutes=1),
    timeframe: str = "1Min",
    seed: int = 0,
    drift: float = 0.0,
    volatility: float = 0.002,
) -> list[Bar]:
    """Generate ``periods`` bars following a seeded random walk."""
    rng = random.Random(f"{symbol}-{seed}")
    ts = start or datetime(2024, 1, 2, 14, 30, tzinfo=UTC)
    price = start_price
    bars: list[Bar] = []
    for _ in range(periods):
        ret = drift + rng.gauss(0, volatility)
        new_price = max(0.01, price * (1 + ret))
        high = max(price, new_price) * (1 + abs(rng.gauss(0, volatility / 2)))
        low = min(price, new_price) * (1 - abs(rng.gauss(0, volatility / 2)))
        volume = rng.randint(1000, 100000)
        bars.append(
            Bar.create(
                symbol=symbol,
                ts=ts,
                open=round(price, 2),
                high=round(high, 2),
                low=round(low, 2),
                close=round(new_price, 2),
                volume=volume,
                timeframe=timeframe,
            )
        )
        price = new_price
        ts = ts + step
    return bars


def trending_bars(
    symbol: str,
    periods: int,
    *,
    start_price: float = 100.0,
    timeframe: str = "1Min",
    swing: float = 0.01,
) -> list[Bar]:
    """A deterministic down -> up -> down series.

    The initial *down* leg lets the fast SMA settle *below* the slow SMA after
    warmup, so the subsequent up leg produces a genuine golden cross (a BUY) and
    the final down leg a death cross (a SELL) -- a full round-trip.
    """
    ts = datetime(2024, 1, 2, 14, 30, tzinfo=UTC)
    bars: list[Bar] = []
    third = max(periods // 3, 1)
    price = start_price
    for i in range(periods):
        if i < third:
            direction = -1
        elif i < 2 * third:
            direction = 1
        else:
            direction = -1
        new_price = max(0.01, price * (1 + direction * swing))
        bars.append(_bar(symbol, ts, price, new_price, timeframe))
        price = new_price
        ts += timedelta(minutes=1)
    return bars


def oscillating_bars(
    symbol: str,
    periods: int,
    *,
    base: float = 100.0,
    amplitude: float = 0.05,
    wavelength: int = 80,
    timeframe: str = "1Min",
) -> list[Bar]:
    """A sine wave -- guarantees repeated MA crossings (multiple round-trips)."""
    ts = datetime(2024, 1, 2, 14, 30, tzinfo=UTC)
    bars: list[Bar] = []
    prev = base
    for i in range(periods):
        price = base * (1 + amplitude * math.sin(2 * math.pi * i / wavelength))
        bars.append(_bar(symbol, ts, prev, price, timeframe))
        prev = price
        ts += timedelta(minutes=1)
    return bars


def multi_symbol_walk(
    symbols: Sequence[str], periods: int, *, seed: int = 0
) -> list[Bar]:
    bars: list[Bar] = []
    for i, sym in enumerate(symbols):
        bars.extend(random_walk_bars(sym, periods, seed=seed + i, start_price=100 + i * 25))
    return bars


__all__ = [
    "Decimal",
    "multi_symbol_walk",
    "oscillating_bars",
    "random_walk_bars",
    "trending_bars",
]
