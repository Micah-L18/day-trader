"""Persistence tests: Decimal exactness and CRUD round-trips (BUILD_PLAN §6.6)."""

from __future__ import annotations

from datetime import UTC
from decimal import Decimal

from trading.core.models import (
    Account,
    Fill,
    Order,
    OrderStatus,
    OrderType,
    Side,
    Signal,
)
from trading.persistence.db import (
    FillRow,
    OrderRow,
    RiskDecisionRow,
    SignalRow,
)
from trading.persistence.repositories import SqlRepository


def test_decimal_round_trips_exactly(repo: SqlRepository) -> None:
    fill = Fill(
        order_id="o1",
        symbol="AAPL",
        side=Side.BUY,
        qty=Decimal("3.5"),
        price=Decimal("123.456789"),
    )
    repo.record_fill(fill)
    fetched = repo.all_fills()
    assert fetched[0].price == Decimal("123.456789")  # no float drift
    assert fetched[0].qty == Decimal("3.5")


def test_signal_and_risk_decision_recorded(repo: SqlRepository) -> None:
    sig = Signal(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET)
    repo.record_signal(sig)
    repo.record_risk_decision(sig, approved=True, reason="approved", checks={"kill_switch": "ok"})
    assert repo.count(SignalRow) == 1
    assert repo.count(RiskDecisionRow) == 1


def test_order_upsert_updates_existing(repo: SqlRepository) -> None:
    order = Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"), type=OrderType.MARKET)
    repo.record_order(order)
    filled = order.with_updates(
        status=OrderStatus.FILLED, filled_qty=Decimal("10"), filled_avg_price=Decimal("100")
    )
    repo.update_order(filled)
    assert repo.count(OrderRow) == 1  # same client_order_id -> updated, not duplicated


def test_fill_recording_is_idempotent(repo: SqlRepository) -> None:
    fill = Fill(order_id="o1", symbol="AAPL", side=Side.BUY, qty=Decimal("1"), price=Decimal("100"))
    repo.record_fill(fill)
    repo.record_fill(fill)  # same fill_id
    assert repo.count(FillRow) == 1


def test_equity_curve_ordered(repo: SqlRepository) -> None:
    from datetime import datetime, timedelta

    base = datetime(2024, 1, 2, tzinfo=UTC)
    for i in range(3):
        acct = Account(
            equity=Decimal(100000 + i),
            buying_power=Decimal("100000"),
            cash=Decimal("100000"),
        )
        repo.record_equity_snapshot(acct, ts=base + timedelta(minutes=i))
    curve = repo.equity_curve()
    assert [e for _, e in curve] == [Decimal("100000"), Decimal("100001"), Decimal("100002")]
