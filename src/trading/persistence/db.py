"""SQLAlchemy engine, session factory and ORM schema (BUILD_PLAN §6.6).

Tables: ``signals``, ``orders``, ``fills``, ``risk_decisions``,
``equity_snapshots``. Money/quantity columns use a custom ``DecimalText`` type so
values round-trip through SQLite as exact ``Decimal`` (SQLite has no native
decimal type; storing as TEXT preserves precision).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, TypeDecorator, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

__all__ = [
    "Base",
    "Database",
    "EquitySnapshotRow",
    "FillRow",
    "OrderRow",
    "RiskDecisionRow",
    "SignalRow",
]


class DecimalText(TypeDecorator[Decimal]):
    """Store ``Decimal`` as TEXT to preserve exact precision in SQLite."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value: Decimal | None, dialect: Any) -> str | None:
        return None if value is None else str(value)

    def process_result_value(self, value: str | None, dialect: Any) -> Decimal | None:
        return None if value is None else Decimal(value)


class Base(DeclarativeBase):
    pass


class SignalRow(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    qty: Mapped[Decimal] = mapped_column(DecimalText)
    type: Mapped[str] = mapped_column(String(16))
    limit_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    stop_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    reason: Mapped[str] = mapped_column(String(256), default="")
    strategy_id: Mapped[str] = mapped_column(String(64), default="", index=True)


class OrderRow(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_order_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    qty: Mapped[Decimal] = mapped_column(DecimalText)
    type: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(20), index=True)
    limit_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    stop_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    stop_loss_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    take_profit_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    filled_qty: Mapped[Decimal] = mapped_column(DecimalText, default=Decimal(0))
    filled_avg_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str] = mapped_column(String(256), default="")
    strategy_id: Mapped[str] = mapped_column(String(64), default="", index=True)


class FillRow(Base):
    __tablename__ = "fills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fill_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    order_id: Mapped[str] = mapped_column(String(64), index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    qty: Mapped[Decimal] = mapped_column(DecimalText)
    price: Mapped[Decimal] = mapped_column(DecimalText)
    fee: Mapped[Decimal] = mapped_column(DecimalText, default=Decimal(0))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RiskDecisionRow(Base):
    __tablename__ = "risk_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(8))
    qty: Mapped[Decimal] = mapped_column(DecimalText)
    approved: Mapped[bool] = mapped_column(Boolean, index=True)
    reason: Mapped[str] = mapped_column(String(256), default="")
    # Per-check results, e.g. {"max_position_size": "ok", "daily_loss": "ok"}.
    checks: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    client_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    strategy_id: Mapped[str] = mapped_column(String(64), default="", index=True)


class EquitySnapshotRow(Base):
    __tablename__ = "equity_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    equity: Mapped[Decimal] = mapped_column(DecimalText)
    cash: Mapped[Decimal] = mapped_column(DecimalText)
    buying_power: Mapped[Decimal] = mapped_column(DecimalText)
    realized_pnl: Mapped[Decimal] = mapped_column(DecimalText, default=Decimal(0))
    unrealized_pnl: Mapped[Decimal] = mapped_column(DecimalText, default=Decimal(0))


class Database:
    """Owns the SQLAlchemy engine + session factory and creates the schema.

    Use ``Database(":memory:")`` (or ``Database.in_memory()``) for tests.
    """

    def __init__(self, db_path: str | Path = "trading.db", *, echo: bool = False) -> None:
        if str(db_path) == ":memory:":
            url = "sqlite:///:memory:"
        else:
            path = Path(db_path)
            if path.parent and not path.parent.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{path}"
        # check_same_thread=False so the engine can be shared with websocket
        # callback threads; access is otherwise serialised by the engine loop.
        self.engine = create_engine(
            url,
            echo=echo,
            future=True,
            connect_args={"check_same_thread": False},
        )
        self._session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        Base.metadata.create_all(self.engine)

    @classmethod
    def in_memory(cls, *, echo: bool = False) -> Database:
        return cls(":memory:", echo=echo)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """A transactional scope: commit on success, rollback on error."""
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def dispose(self) -> None:
        self.engine.dispose()
