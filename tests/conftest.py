"""Shared test fixtures. No test touches the network or a live account."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from trading.broker.base import Broker
from trading.config.settings import RiskLimits
from trading.core.models import (
    Account,
    Order,
    OrderStatus,
    Position,
    utcnow,
)
from trading.persistence.db import Database
from trading.persistence.repositories import SqlRepository


class FakeClock:
    """A controllable clock for rate-limit / time-based tests."""

    def __init__(self, start: datetime | None = None) -> None:
        self.t = start or datetime(2024, 1, 2, 15, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t = self.t + timedelta(seconds=seconds)


class FakeBroker(Broker):
    """A controllable broker for risk-layer tests.

    Account/positions are settable; submitted orders are recorded. ``submit_order``
    still enforces the chokepoint guard so we can prove the invariant holds.
    """

    def __init__(
        self,
        account: Account | None = None,
        positions: list[Position] | None = None,
    ) -> None:
        super().__init__()
        self.account = account or Account(
            equity=Decimal("100000"),
            buying_power=Decimal("100000"),
            cash=Decimal("100000"),
            last_equity=Decimal("100000"),
        )
        self.positions = positions or []
        self.submitted: list[Order] = []
        self.canceled: list[str] = []
        self.fail = False

    def get_account(self) -> Account:
        return self.account

    def get_positions(self) -> list[Position]:
        return list(self.positions)

    def submit_order(self, order: Order) -> Order:
        self._assert_risk_approved()
        if self.fail:
            raise RuntimeError("simulated broker failure")
        submitted = order.with_updates(
            broker_order_id=f"fake-{len(self.submitted) + 1}",
            status=OrderStatus.NEW,
            submitted_at=utcnow(),
        )
        self.submitted.append(submitted)
        return submitted

    def cancel_order(self, order_id: str) -> None:
        self.canceled.append(order_id)

    def get_orders(self, status: str | None = None) -> list[Order]:
        return list(self.submitted)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def db() -> Database:
    return Database.in_memory()


@pytest.fixture
def repo(db: Database) -> SqlRepository:
    return SqlRepository(db)


@pytest.fixture
def account() -> Account:
    return Account(
        equity=Decimal("100000"),
        buying_power=Decimal("100000"),
        cash=Decimal("100000"),
        last_equity=Decimal("100000"),
    )


@pytest.fixture
def broker(account: Account) -> FakeBroker:
    return FakeBroker(account=account)


def make_limits(**overrides: object) -> RiskLimits:
    """Build :class:`RiskLimits` with generous test defaults, ignoring env/.env."""
    defaults: dict[str, object] = {
        "max_position_shares": Decimal("100000"),
        "max_position_notional": Decimal("100000000"),
        "max_gross_exposure": Decimal("100000000"),
        "max_order_notional": Decimal("100000000"),
        "daily_loss_limit": Decimal("100000000"),
        "max_orders_per_minute": 100000,
        "stop_loss_pct": Decimal("0.02"),
    }
    defaults.update(overrides)
    return RiskLimits(_env_file=None, **defaults)  # type: ignore[arg-type]


@pytest.fixture
def limits() -> RiskLimits:
    return make_limits()
