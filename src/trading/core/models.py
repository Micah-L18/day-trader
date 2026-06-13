"""Immutable domain models shared across data, strategy, risk, broker and engine.

Design rules (see BUILD_PLAN §6.2 and §10):

* Every model is a frozen dataclass -- values are passed around, never mutated.
* ``Decimal`` is used for all prices and quantities, never ``float``. Float
  arithmetic silently loses cents; in a system that routes real money that is
  unacceptable.
* The models are deliberately broker-agnostic. Vendor adapters
  (``broker/alpaca.py`` etc.) translate to/from these types so the rest of the
  app never imports a vendor SDK.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

__all__ = [
    "Account",
    "Bar",
    "Fill",
    "Order",
    "OrderStatus",
    "OrderType",
    "Position",
    "Quote",
    "Side",
    "Signal",
    "TimeInForce",
    "new_id",
    "to_decimal",
    "utcnow",
]


def to_decimal(value: Any) -> Decimal:
    """Coerce ints/floats/strings/Decimals to ``Decimal`` without float error.

    Going through ``str`` avoids binary-float artefacts (``Decimal(0.1)`` ->
    ``0.1000000000000000055...``).
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)


def utcnow() -> datetime:
    """Timezone-aware current UTC timestamp."""
    return datetime.now(UTC)


def new_id() -> str:
    """A fresh client-side identifier (used for client_order_id idempotency)."""
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"

    @property
    def sign(self) -> int:
        """+1 for BUY, -1 for SELL -- handy for signed position math."""
        return 1 if self is Side.BUY else -1

    @property
    def opposite(self) -> Side:
        return Side.SELL if self is Side.BUY else Side.BUY


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderStatus(str, Enum):
    PENDING = "pending"  # created locally, not yet acknowledged by broker
    NEW = "new"  # acknowledged / working at broker
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELED = "canceled"
    REJECTED = "rejected"
    EXPIRED = "expired"

    @property
    def is_terminal(self) -> bool:
        return self in {
            OrderStatus.FILLED,
            OrderStatus.CANCELED,
            OrderStatus.REJECTED,
            OrderStatus.EXPIRED,
        }

    @property
    def is_open(self) -> bool:
        return not self.is_terminal


class TimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"
    OPG = "opg"
    CLS = "cls"


# ---------------------------------------------------------------------------
# Market data
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Bar:
    """An OHLCV bar for a single symbol over one ``timeframe`` interval."""

    symbol: str
    ts: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    timeframe: str = ""

    @classmethod
    def create(
        cls,
        symbol: str,
        ts: datetime,
        open: Any,
        high: Any,
        low: Any,
        close: Any,
        volume: Any,
        timeframe: str = "",
    ) -> Bar:
        """Build a bar, coercing numeric inputs to ``Decimal``."""
        return cls(
            symbol=symbol,
            ts=ts,
            open=to_decimal(open),
            high=to_decimal(high),
            low=to_decimal(low),
            close=to_decimal(close),
            volume=to_decimal(volume),
            timeframe=timeframe,
        )


@dataclass(frozen=True, slots=True)
class Quote:
    """A top-of-book bid/ask snapshot for a single symbol."""

    symbol: str
    ts: datetime
    bid: Decimal
    ask: Decimal
    bid_size: Decimal = Decimal(0)
    ask_size: Decimal = Decimal(0)

    @property
    def mid(self) -> Decimal:
        return (self.bid + self.ask) / Decimal(2)

    @property
    def spread(self) -> Decimal:
        return self.ask - self.bid


# ---------------------------------------------------------------------------
# Trading intent / lifecycle
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Signal:
    """A strategy's *intent* to trade. Not an order -- the risk layer decides.

    Strategies emit ``Signal``s only; they never construct ``Order``s or touch a
    broker. ``stop_loss_price`` lets a strategy express a desired protective
    stop; if omitted the risk layer derives one from ``RiskLimits.stop_loss_pct``.
    """

    symbol: str
    side: Side
    qty: Decimal
    type: OrderType = OrderType.MARKET
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    stop_loss_price: Decimal | None = None
    take_profit_price: Decimal | None = None
    time_in_force: TimeInForce = TimeInForce.DAY
    reason: str = ""
    strategy_id: str = ""
    ts: datetime = field(default_factory=utcnow)

    @property
    def is_entry(self) -> bool:
        """Buys are treated as entries; sells as exits/reductions.

        (Short-selling strategies can refine this; the bundled long-only example
        and the daily-loss halt rely on this convention.)
        """
        return self.side is Side.BUY


@dataclass(frozen=True, slots=True)
class Order:
    """A broker order and its current lifecycle state.

    ``client_order_id`` is our idempotency key: it is generated before
    submission so a retry after an ambiguous failure cannot create a duplicate.
    ``broker_order_id`` is assigned by the broker on acknowledgement.
    """

    symbol: str
    side: Side
    qty: Decimal
    type: OrderType = OrderType.MARKET
    status: OrderStatus = OrderStatus.PENDING
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    stop_loss_price: Decimal | None = None
    take_profit_price: Decimal | None = None
    time_in_force: TimeInForce = TimeInForce.DAY
    filled_qty: Decimal = Decimal(0)
    filled_avg_price: Decimal | None = None
    client_order_id: str = field(default_factory=new_id)
    broker_order_id: str | None = None
    submitted_at: datetime | None = None
    updated_at: datetime | None = None
    reason: str = ""
    strategy_id: str = ""

    @property
    def remaining_qty(self) -> Decimal:
        return self.qty - self.filled_qty

    @property
    def is_filled(self) -> bool:
        return self.status is OrderStatus.FILLED

    @property
    def is_terminal(self) -> bool:
        return self.status.is_terminal

    @property
    def notional(self) -> Decimal | None:
        """Best-effort notional from the order's reference price."""
        price = self.limit_price if self.limit_price is not None else self.filled_avg_price
        return None if price is None else (self.qty * price)

    @classmethod
    def from_signal(cls, signal: Signal) -> Order:
        """Materialise an :class:`Order` from an approved :class:`Signal`."""
        return cls(
            symbol=signal.symbol,
            side=signal.side,
            qty=signal.qty,
            type=signal.type,
            limit_price=signal.limit_price,
            stop_price=signal.stop_price,
            stop_loss_price=signal.stop_loss_price,
            take_profit_price=signal.take_profit_price,
            time_in_force=signal.time_in_force,
            reason=signal.reason,
            strategy_id=signal.strategy_id,
        )

    def with_updates(self, **changes: Any) -> Order:
        """Return a copy with ``changes`` applied (frozen-dataclass friendly)."""
        from dataclasses import replace

        return replace(self, **changes)


@dataclass(frozen=True, slots=True)
class Fill:
    """A single execution against an order (orders may fill in several pieces)."""

    order_id: str  # broker_order_id when known, else client_order_id
    symbol: str
    side: Side
    qty: Decimal
    price: Decimal
    ts: datetime = field(default_factory=utcnow)
    fee: Decimal = Decimal(0)
    fill_id: str = field(default_factory=new_id)

    @property
    def notional(self) -> Decimal:
        return self.qty * self.price


# ---------------------------------------------------------------------------
# Account state
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Position:
    """A signed position: positive ``qty`` is long, negative is short."""

    symbol: str
    qty: Decimal
    avg_price: Decimal
    current_price: Decimal | None = None
    unrealized_pnl: Decimal = Decimal(0)

    @property
    def is_long(self) -> bool:
        return self.qty > 0

    @property
    def is_short(self) -> bool:
        return self.qty < 0

    @property
    def is_flat(self) -> bool:
        return self.qty == 0

    @property
    def market_value(self) -> Decimal:
        price = self.current_price if self.current_price is not None else self.avg_price
        return self.qty * price

    @property
    def gross_value(self) -> Decimal:
        """Absolute market value -- used for gross-exposure limits."""
        return abs(self.market_value)


@dataclass(frozen=True, slots=True)
class Account:
    """A snapshot of brokerage account balances."""

    equity: Decimal
    buying_power: Decimal
    cash: Decimal
    last_equity: Decimal | None = None  # prior trading day's close (P&L baseline)
    ts: datetime = field(default_factory=utcnow)
