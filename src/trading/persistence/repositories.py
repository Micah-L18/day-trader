"""Repositories: translate domain models to ORM rows and persist them.

``Repository`` is a ``Protocol`` so the engine/risk layer depend on the
*behaviour*, not the SQLAlchemy implementation. ``SqlRepository`` is the real
thing; ``NullRepository`` is a no-op used in unit tests that don't care about
persistence.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Protocol, runtime_checkable

from sqlalchemy import select

from trading.core.models import (
    Account,
    Fill,
    Order,
    Signal,
    utcnow,
)
from trading.persistence.db import (
    Database,
    EquitySnapshotRow,
    FillRow,
    OrderRow,
    RiskDecisionRow,
    SignalRow,
)

__all__ = ["NullRepository", "Repository", "SqlRepository"]


@runtime_checkable
class Repository(Protocol):
    """The persistence surface used by the risk layer and engine."""

    def record_signal(self, signal: Signal) -> None: ...

    def record_order(self, order: Order) -> None: ...

    def update_order(self, order: Order) -> None: ...

    def record_fill(self, fill: Fill) -> None: ...

    def record_risk_decision(
        self,
        signal: Signal,
        *,
        approved: bool,
        reason: str,
        checks: dict[str, str] | None = None,
        client_order_id: str | None = None,
    ) -> None: ...

    def record_equity_snapshot(
        self,
        account: Account,
        *,
        realized_pnl: Decimal = Decimal(0),
        unrealized_pnl: Decimal = Decimal(0),
        ts: datetime | None = None,
    ) -> None: ...


class SqlRepository:
    """SQLAlchemy-backed :class:`Repository`."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def record_signal(self, signal: Signal) -> None:
        with self._db.session() as s:
            s.add(
                SignalRow(
                    ts=signal.ts,
                    symbol=signal.symbol,
                    side=signal.side.value,
                    qty=signal.qty,
                    type=signal.type.value,
                    limit_price=signal.limit_price,
                    stop_price=signal.stop_price,
                    reason=signal.reason,
                    strategy_id=signal.strategy_id,
                )
            )

    def record_order(self, order: Order) -> None:
        with self._db.session() as s:
            s.add(_order_to_row(order))

    def update_order(self, order: Order) -> None:
        """Upsert an order by ``client_order_id`` (orders evolve over time)."""
        with self._db.session() as s:
            row = s.scalar(
                select(OrderRow).where(OrderRow.client_order_id == order.client_order_id)
            )
            if row is None:
                s.add(_order_to_row(order))
                return
            row.broker_order_id = order.broker_order_id
            row.status = order.status.value
            row.filled_qty = order.filled_qty
            row.filled_avg_price = order.filled_avg_price
            row.limit_price = order.limit_price
            row.stop_price = order.stop_price
            row.stop_loss_price = order.stop_loss_price
            row.take_profit_price = order.take_profit_price
            row.submitted_at = order.submitted_at
            row.updated_at = order.updated_at or utcnow()

    def record_fill(self, fill: Fill) -> None:
        with self._db.session() as s:
            # Idempotent: ignore duplicate fill_ids (broker may resend).
            exists = s.scalar(select(FillRow.id).where(FillRow.fill_id == fill.fill_id))
            if exists is not None:
                return
            s.add(
                FillRow(
                    fill_id=fill.fill_id,
                    order_id=fill.order_id,
                    symbol=fill.symbol,
                    side=fill.side.value,
                    qty=fill.qty,
                    price=fill.price,
                    fee=fill.fee,
                    ts=fill.ts,
                )
            )

    def record_risk_decision(
        self,
        signal: Signal,
        *,
        approved: bool,
        reason: str,
        checks: dict[str, str] | None = None,
        client_order_id: str | None = None,
    ) -> None:
        with self._db.session() as s:
            s.add(
                RiskDecisionRow(
                    ts=utcnow(),
                    symbol=signal.symbol,
                    side=signal.side.value,
                    qty=signal.qty,
                    approved=approved,
                    reason=reason,
                    checks=checks,
                    client_order_id=client_order_id,
                    strategy_id=signal.strategy_id,
                )
            )

    def record_equity_snapshot(
        self,
        account: Account,
        *,
        realized_pnl: Decimal = Decimal(0),
        unrealized_pnl: Decimal = Decimal(0),
        ts: datetime | None = None,
    ) -> None:
        with self._db.session() as s:
            s.add(
                EquitySnapshotRow(
                    ts=ts or utcnow(),
                    equity=account.equity,
                    cash=account.cash,
                    buying_power=account.buying_power,
                    realized_pnl=realized_pnl,
                    unrealized_pnl=unrealized_pnl,
                )
            )

    # -- read helpers (used by reporting/tests) ----------------------------
    def count(self, model: type) -> int:
        with self._db.session() as s:
            return len(list(s.scalars(select(model))))

    def equity_curve(self) -> list[tuple[datetime, Decimal]]:
        """Return ``(ts, equity)`` points in chronological order."""
        with self._db.session() as s:
            rows = s.scalars(
                select(EquitySnapshotRow).order_by(EquitySnapshotRow.ts, EquitySnapshotRow.id)
            )
            return [(r.ts, r.equity) for r in rows]

    def all_fills(self) -> list[Fill]:
        """Return all fills in chronological order as domain objects."""
        from trading.core.models import Side

        with self._db.session() as s:
            rows = s.scalars(select(FillRow).order_by(FillRow.ts, FillRow.id))
            return [
                Fill(
                    order_id=r.order_id,
                    symbol=r.symbol,
                    side=Side(r.side),
                    qty=r.qty,
                    price=r.price,
                    ts=r.ts,
                    fee=r.fee,
                    fill_id=r.fill_id,
                )
                for r in rows
            ]


class NullRepository:
    """A :class:`Repository` that records nothing -- for unit tests."""

    def record_signal(self, signal: Signal) -> None:
        return None

    def record_order(self, order: Order) -> None:
        return None

    def update_order(self, order: Order) -> None:
        return None

    def record_fill(self, fill: Fill) -> None:
        return None

    def record_risk_decision(
        self,
        signal: Signal,
        *,
        approved: bool,
        reason: str,
        checks: dict[str, str] | None = None,
        client_order_id: str | None = None,
    ) -> None:
        return None

    def record_equity_snapshot(
        self,
        account: Account,
        *,
        realized_pnl: Decimal = Decimal(0),
        unrealized_pnl: Decimal = Decimal(0),
        ts: datetime | None = None,
    ) -> None:
        return None


def _order_to_row(order: Order) -> OrderRow:
    return OrderRow(
        client_order_id=order.client_order_id,
        broker_order_id=order.broker_order_id,
        symbol=order.symbol,
        side=order.side.value,
        qty=order.qty,
        type=order.type.value,
        status=order.status.value,
        limit_price=order.limit_price,
        stop_price=order.stop_price,
        stop_loss_price=order.stop_loss_price,
        take_profit_price=order.take_profit_price,
        filled_qty=order.filled_qty,
        filled_avg_price=order.filled_avg_price,
        submitted_at=order.submitted_at,
        updated_at=order.updated_at or utcnow(),
        reason=order.reason,
        strategy_id=order.strategy_id,
    )
