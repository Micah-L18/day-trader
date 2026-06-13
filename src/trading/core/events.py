"""Event types for the engine loop.

The engine consumes a single ordered stream of :class:`Event` objects regardless
of mode. In backtest mode the historical replay provider produces ``BarEvent`` /
``QuoteEvent`` in timestamp order; in paper/live mode the same events arrive from
websocket callbacks. Order/fill updates and connection state arrive as their own
events so the loop has one uniform thing to react to.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from trading.core.models import Bar, Fill, Order, Quote, utcnow

__all__ = [
    "BarEvent",
    "ConnectionEvent",
    "ErrorEvent",
    "Event",
    "EventType",
    "FillEvent",
    "OrderUpdateEvent",
    "QuoteEvent",
    "SessionEvent",
    "ShutdownEvent",
]


class EventType(str, Enum):
    BAR = "bar"
    QUOTE = "quote"
    ORDER_UPDATE = "order_update"
    FILL = "fill"
    CONNECTION = "connection"
    SESSION = "session"
    ERROR = "error"
    SHUTDOWN = "shutdown"


@dataclass(frozen=True, slots=True)
class Event:
    """Base event. ``ts`` is the event's logical time (drives backtest clock)."""

    type: EventType
    ts: datetime = field(default_factory=utcnow)


@dataclass(frozen=True, slots=True)
class BarEvent(Event):
    bar: Bar | None = None

    @classmethod
    def of(cls, bar: Bar) -> BarEvent:
        return cls(type=EventType.BAR, ts=bar.ts, bar=bar)


@dataclass(frozen=True, slots=True)
class QuoteEvent(Event):
    quote: Quote | None = None

    @classmethod
    def of(cls, quote: Quote) -> QuoteEvent:
        return cls(type=EventType.QUOTE, ts=quote.ts, quote=quote)


@dataclass(frozen=True, slots=True)
class OrderUpdateEvent(Event):
    order: Order | None = None

    @classmethod
    def of(cls, order: Order) -> OrderUpdateEvent:
        return cls(type=EventType.ORDER_UPDATE, ts=order.updated_at or utcnow(), order=order)


@dataclass(frozen=True, slots=True)
class FillEvent(Event):
    fill: Fill | None = None

    @classmethod
    def of(cls, fill: Fill) -> FillEvent:
        return cls(type=EventType.FILL, ts=fill.ts, fill=fill)


@dataclass(frozen=True, slots=True)
class ConnectionEvent(Event):
    """Emitted when the data/broker connection changes state.

    A drop to ``connected=False`` is an ambiguous condition: the engine's
    fail-safe response is to stop initiating new trades until reconnected.
    """

    connected: bool = True
    detail: str = ""

    @classmethod
    def of(cls, connected: bool, detail: str = "") -> ConnectionEvent:
        return cls(type=EventType.CONNECTION, connected=connected, detail=detail)


class SessionPhase(str, Enum):
    PRE_OPEN = "pre_open"
    OPEN = "open"
    CLOSING = "closing"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class SessionEvent(Event):
    """Market-session boundary (open/close), so strategies/engine can react."""

    phase: SessionPhase = SessionPhase.CLOSED

    @classmethod
    def of(cls, phase: SessionPhase) -> SessionEvent:
        return cls(type=EventType.SESSION, phase=phase)


@dataclass(frozen=True, slots=True)
class ErrorEvent(Event):
    """A recoverable or fatal error. ``fatal`` errors trigger a safe shutdown."""

    message: str = ""
    fatal: bool = False

    @classmethod
    def of(cls, message: str, *, fatal: bool = False) -> ErrorEvent:
        return cls(type=EventType.ERROR, message=message, fatal=fatal)


@dataclass(frozen=True, slots=True)
class ShutdownEvent(Event):
    """Sentinel that tells the engine loop to drain and stop."""

    reason: str = ""

    @classmethod
    def of(cls, reason: str = "") -> ShutdownEvent:
        return cls(type=EventType.SHUTDOWN, reason=reason)
