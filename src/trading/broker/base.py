"""Abstract broker interface + the chokepoint guard (BUILD_PLAN §6.4, §2).

The single most important invariant in this app: **no order reaches a broker
without passing through the risk layer.** We enforce it two ways:

1. *Architecturally* -- only :class:`~trading.risk.risk_layer.RiskLayer` holds a
   reference used for submission; the engine never calls ``submit_order``.
2. *At runtime* -- ``submit_order`` asserts it is running inside the
   :func:`risk_approval` context, which only the risk layer enters. A stray
   ``broker.submit_order(...)`` from anywhere else raises immediately rather
   than silently bypassing risk checks.

Reads (account, positions, orders) and ``cancel_order`` are *not* gated: they
either reduce risk or are inert.
"""

from __future__ import annotations

import contextvars
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from trading.core.models import Account, Bar, Fill, Order, Position

OrderUpdateCallback = Callable[[Order], None]
FillCallback = Callable[[Fill], None]

# Set only while RiskLayer.submit is calling broker.submit_order.
_RISK_APPROVED: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "risk_approved", default=False
)


@contextmanager
def risk_approval() -> Iterator[None]:
    """Authorise broker submission for the duration of the block.

    Only the risk layer should use this. Entering it is what lets
    ``Broker.submit_order`` run.
    """
    token = _RISK_APPROVED.set(True)
    try:
        yield
    finally:
        _RISK_APPROVED.reset(token)


class ChokepointError(RuntimeError):
    """Raised when ``submit_order`` is called outside the risk-approval context."""


class Broker(ABC):
    """A brokerage account: read state, submit/cancel orders, receive updates."""

    def __init__(self) -> None:
        self._on_order_update: OrderUpdateCallback | None = None
        self._on_fill: FillCallback | None = None

    # -- event wiring ------------------------------------------------------
    def set_event_sink(
        self,
        on_order_update: OrderUpdateCallback | None = None,
        on_fill: FillCallback | None = None,
    ) -> None:
        """Register where order-status and fill events should be delivered.

        Simulated brokers invoke these synchronously; live brokers invoke them
        from their trade-update stream (which the engine marshals onto its loop).
        """
        self._on_order_update = on_order_update
        self._on_fill = on_fill

    def _emit_order_update(self, order: Order) -> None:
        if self._on_order_update is not None:
            self._on_order_update(order)

    def _emit_fill(self, fill: Fill) -> None:
        if self._on_fill is not None:
            self._on_fill(fill)

    # -- chokepoint guard --------------------------------------------------
    @staticmethod
    def _assert_risk_approved() -> None:
        if not _RISK_APPROVED.get():
            raise ChokepointError(
                "broker.submit_order was called outside the risk layer. Every "
                "order must go through RiskLayer.submit (BUILD_PLAN guardrail §2)."
            )

    # -- account / positions ----------------------------------------------
    @abstractmethod
    def get_account(self) -> Account: ...

    @abstractmethod
    def get_positions(self) -> list[Position]: ...

    def get_position(self, symbol: str) -> Position | None:
        for p in self.get_positions():
            if p.symbol == symbol:
                return p
        return None

    # -- orders ------------------------------------------------------------
    @abstractmethod
    def submit_order(self, order: Order) -> Order:
        """Submit an order. MUST call ``self._assert_risk_approved()`` first.

        Implementations attach a server-side protective stop when
        ``order.stop_loss_price`` is set (bracket/OTO), so positions stay
        protected even if the app crashes (BUILD_PLAN §2, §6.4).
        """

    @abstractmethod
    def cancel_order(self, order_id: str) -> None: ...

    @abstractmethod
    def get_orders(self, status: str | None = None) -> list[Order]: ...

    # -- market-data hook (simulated brokers only) ------------------------
    def on_bar(self, bar: Bar) -> None:
        """Feed a bar to the broker. Real brokers ignore this; the fill simulator
        uses it to mark positions and trigger resting stop/limit orders."""
        return None

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        """Start any background streams (e.g. trade updates). Default: no-op."""
        return None

    def stop(self) -> None:
        """Release resources. Default: no-op."""
        return None

    def __enter__(self) -> Broker:
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()
