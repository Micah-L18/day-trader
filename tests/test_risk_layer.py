"""Risk-layer tests -- the priority suite (BUILD_PLAN §6.5, §8).

Each configurable limit gets a pass case and a reject case, plus the kill switch,
daily-loss halt, the chokepoint guard, protective-stop attachment and fail-safe
behaviour on broker errors.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from conftest import FakeBroker, make_limits
from trading.broker.base import ChokepointError
from trading.core.models import (
    Account,
    OrderType,
    Position,
    Side,
    Signal,
)
from trading.persistence.repositories import SqlRepository
from trading.risk.risk_layer import RiskLayer


def _buy(symbol: str = "AAPL", qty: int = 10, **kw: object) -> Signal:
    return Signal(symbol=symbol, side=Side.BUY, qty=Decimal(qty), type=OrderType.MARKET, **kw)


def _sell(symbol: str = "AAPL", qty: int = 10, **kw: object) -> Signal:
    return Signal(symbol=symbol, side=Side.SELL, qty=Decimal(qty), type=OrderType.MARKET, **kw)


def _risk(broker: FakeBroker, repo: SqlRepository, clock=None, **limit_kw: object) -> RiskLayer:
    rl = RiskLayer(broker, make_limits(**limit_kw), repo, clock=clock) if clock else RiskLayer(
        broker, make_limits(**limit_kw), repo
    )
    rl.update_price("AAPL", Decimal("100"))
    rl.update_price("MSFT", Decimal("100"))
    return rl


# ---------------------------------------------------------------------------
# Baseline / happy path
# ---------------------------------------------------------------------------
def test_approves_valid_order(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo)
    decision = risk.submit(_buy(qty=10))
    assert decision.approved
    assert decision.order is not None
    assert len(broker.submitted) == 1
    assert broker.submitted[0].symbol == "AAPL"


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------
def test_kill_switch_blocks_then_releases(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo)
    risk.engage_kill_switch()
    decision = risk.submit(_buy())
    assert not decision.approved
    assert "kill switch" in decision.reason
    assert broker.submitted == []

    risk.disengage_kill_switch()
    assert risk.submit(_buy()).approved


def test_kill_switch_flatten_closes_positions(repo: SqlRepository) -> None:
    broker = FakeBroker(
        positions=[Position(symbol="AAPL", qty=Decimal("50"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))]
    )
    risk = _risk(broker, repo)
    risk.engage_kill_switch(flatten=True)
    # A flatten exit was submitted despite the kill switch.
    assert len(broker.submitted) == 1
    assert broker.submitted[0].side is Side.SELL
    assert broker.submitted[0].qty == Decimal("50")


# ---------------------------------------------------------------------------
# Positive-quantity sanity
# ---------------------------------------------------------------------------
def test_rejects_non_positive_qty(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo)
    assert not risk.submit(_buy(qty=0)).approved
    assert broker.submitted == []


def test_accepts_positive_qty(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo)
    assert risk.submit(_buy(qty=1)).approved


# ---------------------------------------------------------------------------
# Reference price required (fail safe)
# ---------------------------------------------------------------------------
def test_rejects_when_no_reference_price(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = RiskLayer(broker, make_limits(), repo)  # no prices fed
    decision = risk.submit(_buy(symbol="TSLA"))
    assert not decision.approved
    assert "reference price" in decision.reason


def test_limit_price_serves_as_reference(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = RiskLayer(broker, make_limits(), repo)
    decision = risk.submit(
        Signal(symbol="TSLA", side=Side.BUY, qty=Decimal("1"), type=OrderType.LIMIT,
               limit_price=Decimal("250"))
    )
    assert decision.approved


# ---------------------------------------------------------------------------
# Order notional ceiling
# ---------------------------------------------------------------------------
def test_rejects_order_over_notional_ceiling(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, max_order_notional=Decimal("1000"))
    decision = risk.submit(_buy(qty=20))  # 20 * 100 = 2000 > 1000
    assert not decision.approved
    assert "order notional" in decision.reason


def test_accepts_order_within_notional_ceiling(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, max_order_notional=Decimal("1000"))
    assert risk.submit(_buy(qty=5)).approved  # 500 <= 1000


# ---------------------------------------------------------------------------
# Rate limit
# ---------------------------------------------------------------------------
def test_rate_limit_blocks_burst(broker: FakeBroker, repo: SqlRepository, clock) -> None:
    risk = _risk(broker, repo, clock=clock, max_orders_per_minute=2)
    assert risk.submit(_buy(qty=1)).approved
    assert risk.submit(_buy(qty=1)).approved
    third = risk.submit(_buy(qty=1))
    assert not third.approved
    assert "60s" in third.reason


def test_rate_limit_resets_after_window(broker: FakeBroker, repo: SqlRepository, clock) -> None:
    risk = _risk(broker, repo, clock=clock, max_orders_per_minute=1)
    assert risk.submit(_buy(qty=1)).approved
    assert not risk.submit(_buy(qty=1)).approved
    clock.advance(61)
    assert risk.submit(_buy(qty=1)).approved


# ---------------------------------------------------------------------------
# Max position size (shares + notional)
# ---------------------------------------------------------------------------
def test_rejects_position_over_share_cap(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, max_position_shares=Decimal("100"))
    assert not risk.submit(_buy(qty=150)).approved


def test_accepts_position_within_share_cap(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, max_position_shares=Decimal("100"))
    assert risk.submit(_buy(qty=50)).approved


def test_reduction_allowed_even_when_over_cap(repo: SqlRepository) -> None:
    # Already holding 200 (over a 100 cap); selling 50 reduces and must be allowed.
    broker = FakeBroker(
        positions=[Position(symbol="AAPL", qty=Decimal("200"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))]
    )
    risk = _risk(broker, repo, max_position_shares=Decimal("100"))
    assert risk.submit(_sell(qty=50)).approved


def test_rejects_position_over_notional_cap(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, max_position_shares=Decimal("1000000"),
                 max_position_notional=Decimal("10000"))
    assert not risk.submit(_buy(qty=150)).approved  # 150 * 100 = 15000 > 10000


# ---------------------------------------------------------------------------
# Gross exposure
# ---------------------------------------------------------------------------
def test_rejects_over_gross_exposure(repo: SqlRepository) -> None:
    broker = FakeBroker(
        positions=[Position(symbol="MSFT", qty=Decimal("80"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))]  # 8000 gross
    )
    risk = _risk(broker, repo, max_gross_exposure=Decimal("10000"))
    # Adding 50 AAPL @100 = 5000 -> projected gross 13000 > 10000.
    assert not risk.submit(_buy(symbol="AAPL", qty=50)).approved


def test_accepts_within_gross_exposure(repo: SqlRepository) -> None:
    broker = FakeBroker(
        positions=[Position(symbol="MSFT", qty=Decimal("80"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))]
    )
    risk = _risk(broker, repo, max_gross_exposure=Decimal("20000"))
    assert risk.submit(_buy(symbol="AAPL", qty=50)).approved


# ---------------------------------------------------------------------------
# Buying power
# ---------------------------------------------------------------------------
def test_rejects_over_buying_power(repo: SqlRepository) -> None:
    broker = FakeBroker(
        account=Account(equity=Decimal("100000"), buying_power=Decimal("1000"),
                        cash=Decimal("1000"), last_equity=Decimal("100000"))
    )
    risk = _risk(broker, repo)
    assert not risk.submit(_buy(qty=20)).approved  # 2000 > 1000


def test_buying_power_not_required_for_exits(repo: SqlRepository) -> None:
    broker = FakeBroker(
        account=Account(equity=Decimal("100000"), buying_power=Decimal("0"),
                        cash=Decimal("0"), last_equity=Decimal("100000")),
        positions=[Position(symbol="AAPL", qty=Decimal("50"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))],
    )
    risk = _risk(broker, repo)
    assert risk.submit(_sell(qty=50)).approved


# ---------------------------------------------------------------------------
# Daily-loss halt
# ---------------------------------------------------------------------------
def test_daily_loss_halt_blocks_entries_allows_exits(repo: SqlRepository) -> None:
    broker = FakeBroker(
        account=Account(equity=Decimal("97000"), buying_power=Decimal("100000"),
                        cash=Decimal("97000"), last_equity=Decimal("100000")),
        positions=[Position(symbol="AAPL", qty=Decimal("50"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))],
    )
    risk = _risk(broker, repo, daily_loss_limit=Decimal("2000"))
    # pnl = 97000 - 100000 = -3000 <= -2000 -> halt.
    assert not risk.submit(_buy(qty=10)).approved  # entry blocked
    assert risk.halted
    assert risk.submit(_sell(qty=50)).approved  # exit allowed


def test_no_halt_within_loss_limit(repo: SqlRepository) -> None:
    broker = FakeBroker(
        account=Account(equity=Decimal("99000"), buying_power=Decimal("100000"),
                        cash=Decimal("99000"), last_equity=Decimal("100000"))
    )
    risk = _risk(broker, repo, daily_loss_limit=Decimal("2000"))
    assert risk.submit(_buy(qty=10)).approved  # -1000 loss, within limit
    assert not risk.halted


def test_reset_daily_clears_halt(repo: SqlRepository) -> None:
    broker = FakeBroker(
        account=Account(equity=Decimal("97000"), buying_power=Decimal("100000"),
                        cash=Decimal("97000"), last_equity=Decimal("100000"))
    )
    risk = _risk(broker, repo, daily_loss_limit=Decimal("2000"))
    risk.submit(_buy(qty=10))
    assert risk.halted
    # Recover equity, then reset.
    broker.account = Account(equity=Decimal("100000"), buying_power=Decimal("100000"),
                             cash=Decimal("100000"), last_equity=Decimal("100000"))
    risk.reset_daily()
    assert not risk.halted
    assert risk.submit(_buy(qty=10)).approved


# ---------------------------------------------------------------------------
# Protective stop attachment
# ---------------------------------------------------------------------------
def test_entry_gets_protective_stop_attached(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, stop_loss_pct=Decimal("0.02"))
    risk.submit(_buy(qty=10))  # price 100 -> stop 98.00
    assert broker.submitted[0].stop_loss_price == Decimal("98.00")


def test_strategy_supplied_stop_is_respected(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo, stop_loss_pct=Decimal("0.02"))
    risk.submit(_buy(qty=10, stop_loss_price=Decimal("95.00")))
    assert broker.submitted[0].stop_loss_price == Decimal("95.00")


def test_exit_does_not_get_stop(repo: SqlRepository) -> None:
    broker = FakeBroker(
        positions=[Position(symbol="AAPL", qty=Decimal("50"), avg_price=Decimal("100"),
                            current_price=Decimal("100"))]
    )
    risk = _risk(broker, repo, stop_loss_pct=Decimal("0.02"))
    risk.submit(_sell(qty=50))
    assert broker.submitted[0].stop_loss_price is None


# ---------------------------------------------------------------------------
# Chokepoint enforcement
# ---------------------------------------------------------------------------
def test_direct_broker_submit_is_forbidden(broker: FakeBroker) -> None:
    from trading.core.models import Order

    with pytest.raises(ChokepointError):
        broker.submit_order(Order(symbol="AAPL", side=Side.BUY, qty=Decimal("1")))


def test_risk_layer_submit_is_allowed(broker: FakeBroker, repo: SqlRepository) -> None:
    risk = _risk(broker, repo)
    assert risk.submit(_buy(qty=1)).approved  # goes through the approval context


# ---------------------------------------------------------------------------
# Fail-safe on broker error
# ---------------------------------------------------------------------------
def test_broker_error_is_failsafe(broker: FakeBroker, repo: SqlRepository) -> None:
    broker.fail = True
    risk = _risk(broker, repo)
    decision = risk.submit(_buy(qty=1))
    assert not decision.approved
    assert "broker_error" in decision.reason


# ---------------------------------------------------------------------------
# Persistence of decisions
# ---------------------------------------------------------------------------
def test_decisions_are_logged(broker: FakeBroker, repo: SqlRepository) -> None:
    from trading.persistence.db import RiskDecisionRow, SignalRow

    risk = _risk(broker, repo)
    risk.submit(_buy(qty=1))
    risk.engage_kill_switch()
    risk.submit(_buy(qty=1))
    assert repo.count(SignalRow) == 2
    assert repo.count(RiskDecisionRow) == 2
