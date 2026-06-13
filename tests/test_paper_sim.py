"""Simulated-broker (fill simulator) tests."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from trading.broker.base import ChokepointError, risk_approval
from trading.broker.paper_sim import SimulatedBroker
from trading.core.models import (
    Bar,
    Fill,
    Order,
    OrderStatus,
    OrderType,
    Side,
)


def _bar(
    symbol: str,
    close: float,
    *,
    open_: float | None = None,
    high: float | None = None,
    low: float | None = None,
) -> Bar:
    c = Decimal(str(close))
    return Bar(
        symbol=symbol,
        ts=datetime(2024, 1, 2, 15, 0, tzinfo=UTC),
        open=Decimal(str(open_)) if open_ is not None else c,
        high=Decimal(str(high)) if high else c,
        low=Decimal(str(low)) if low else c,
        close=c,
        volume=Decimal("1000"),
    )


def _submit(broker: SimulatedBroker, order: Order) -> Order:
    with risk_approval():
        return broker.submit_order(order)


def test_submit_requires_risk_approval() -> None:
    broker = SimulatedBroker()
    broker.on_bar(_bar("AAPL", 100))
    with pytest.raises(ChokepointError):
        broker.submit_order(Order(symbol="AAPL", side=Side.BUY, qty=Decimal("1")))


def test_market_buy_fills_and_updates_position() -> None:
    broker = SimulatedBroker(Decimal("100000"))
    fills: list[Fill] = []
    broker.set_event_sink(on_fill=fills.append)
    broker.on_bar(_bar("AAPL", 100))

    order = _submit(
        broker, Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET)
    )
    assert order.status is OrderStatus.FILLED
    assert order.filled_avg_price == Decimal("100")
    assert len(fills) == 1

    pos = broker.get_position("AAPL")
    assert pos is not None and pos.qty == Decimal("10")
    assert broker.get_account().cash == Decimal("99000")  # 100000 - 10*100


def test_market_order_rejected_without_price() -> None:
    broker = SimulatedBroker()
    order = _submit(broker, Order(symbol="AAPL", side=Side.BUY, qty=Decimal("1")))
    assert order.status is OrderStatus.REJECTED


def test_protective_stop_triggers_and_flattens() -> None:
    broker = SimulatedBroker(Decimal("100000"))
    broker.on_bar(_bar("AAPL", 100))
    _submit(
        broker,
        Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET,
              stop_loss_price=Decimal("98")),
    )
    assert broker.get_position("AAPL").qty == Decimal("10")  # type: ignore[union-attr]

    # Bar opens at 99 (above the stop) then dips to 97 intrabar -> stop fills at 98.
    broker.on_bar(_bar("AAPL", 97, open_=99, high=99, low=97))
    assert broker.get_position("AAPL") is None
    # Realised loss = (98 - 100) * 10 = -20.
    assert broker.realized_pnl == Decimal("-20")


def test_protective_stop_gap_down_fills_at_open() -> None:
    broker = SimulatedBroker(Decimal("100000"))
    broker.on_bar(_bar("AAPL", 100))
    _submit(
        broker,
        Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET,
              stop_loss_price=Decimal("98")),
    )
    # Gap straight through the stop: opens at 97 -> fills at 97 (worse than stop).
    broker.on_bar(_bar("AAPL", 97, open_=97, high=97, low=96))
    assert broker.get_position("AAPL") is None
    assert broker.realized_pnl == Decimal("-30")  # (97 - 100) * 10


def test_round_trip_realized_pnl() -> None:
    broker = SimulatedBroker(Decimal("100000"))
    broker.on_bar(_bar("AAPL", 100))
    _submit(broker, Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET))
    broker.on_bar(_bar("AAPL", 110))
    _submit(broker, Order(symbol="AAPL", side=Side.SELL, qty=Decimal("10"), type=OrderType.MARKET))
    assert broker.realized_pnl == Decimal("100")  # (110-100)*10
    assert broker.get_position("AAPL") is None


def test_limit_order_rests_then_fills() -> None:
    broker = SimulatedBroker(Decimal("100000"))
    broker.on_bar(_bar("AAPL", 100))
    _submit(
        broker,
        Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.LIMIT,
              limit_price=Decimal("95")),
    )
    # Not filled yet (price above limit).
    assert broker.get_position("AAPL") is None
    # Price dips to the limit -> fills.
    broker.on_bar(_bar("AAPL", 96, high=97, low=94))
    pos = broker.get_position("AAPL")
    assert pos is not None and pos.qty == Decimal("10")


def test_slippage_applied_to_market_orders() -> None:
    broker = SimulatedBroker(Decimal("100000"), slippage_pct=Decimal("0.01"))
    broker.on_bar(_bar("AAPL", 100))
    order = _submit(
        broker, Order(symbol="AAPL", side=Side.BUY, qty=Decimal("1"), type=OrderType.MARKET)
    )
    assert order.filled_avg_price == Decimal("101.00")  # buy pays 1% more
