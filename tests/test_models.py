"""Core model tests: Decimal discipline and lifecycle helpers."""

from __future__ import annotations

from decimal import Decimal

from trading.core.models import (
    Bar,
    Order,
    OrderStatus,
    OrderType,
    Position,
    Side,
    Signal,
    to_decimal,
    utcnow,
)


def test_to_decimal_avoids_float_artifacts() -> None:
    assert to_decimal(0.1) == Decimal("0.1")
    assert to_decimal("1.23") == Decimal("1.23")
    assert to_decimal(5) == Decimal("5")
    assert isinstance(to_decimal(1.5), Decimal)


def test_bar_create_coerces_to_decimal() -> None:
    b = Bar.create("AAPL", utcnow(), 1, 2, 0.5, 1.5, 100)
    assert isinstance(b.close, Decimal)
    assert b.high == Decimal("2")


def test_side_helpers() -> None:
    assert Side.BUY.sign == 1
    assert Side.SELL.sign == -1
    assert Side.BUY.opposite is Side.SELL


def test_order_status_terminal() -> None:
    assert OrderStatus.FILLED.is_terminal
    assert OrderStatus.REJECTED.is_terminal
    assert not OrderStatus.NEW.is_terminal
    assert OrderStatus.NEW.is_open


def test_order_from_signal_carries_fields() -> None:
    sig = Signal(
        symbol="AAPL",
        side=Side.BUY,
        qty=Decimal("10"),
        type=OrderType.LIMIT,
        limit_price=Decimal("100"),
        stop_loss_price=Decimal("95"),
        reason="test",
    )
    order = Order.from_signal(sig)
    assert order.symbol == "AAPL"
    assert order.limit_price == Decimal("100")
    assert order.stop_loss_price == Decimal("95")
    assert order.client_order_id  # generated


def test_order_with_updates_is_immutable_copy() -> None:
    order = Order(symbol="AAPL", side=Side.BUY, qty=Decimal("10"))
    updated = order.with_updates(filled_qty=Decimal("4"))
    assert order.filled_qty == Decimal("0")  # original untouched
    assert updated.filled_qty == Decimal("4")
    assert updated.remaining_qty == Decimal("6")


def test_position_value_math() -> None:
    long = Position("AAPL", Decimal("10"), Decimal("100"), current_price=Decimal("110"))
    assert long.market_value == Decimal("1100")
    assert long.gross_value == Decimal("1100")
    assert long.is_long

    short = Position("AAPL", Decimal("-10"), Decimal("100"), current_price=Decimal("110"))
    assert short.market_value == Decimal("-1100")
    assert short.gross_value == Decimal("1100")
    assert short.is_short


def test_signal_entry_classification() -> None:
    assert Signal("AAPL", Side.BUY, Decimal("1")).is_entry
    assert not Signal("AAPL", Side.SELL, Decimal("1")).is_entry
