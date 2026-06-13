"""The Risk Layer -- the most important component (BUILD_PLAN §6.5).

``RiskLayer`` is the *only* thing permitted to call ``broker.submit_order`` (it
enters the :func:`~trading.broker.base.risk_approval` context; the broker rejects
any submission made outside it). The engine hands it :class:`Signal`s; it
converts them to :class:`Order`s only if **every** check passes, otherwise it
rejects and logs.

Mandatory checks (all configurable via :class:`RiskLimits`):

* kill switch
* daily-loss halt (realised+unrealised vs start-of-day equity; blocks new
  *entries*, still allows exits)
* order sanity (positive qty, known price, hard notional ceiling)
* max position size per symbol (shares and notional)
* max total gross exposure
* buying-power check
* orders-per-minute rate limit
* attach a server-side protective stop to entries

Fail-safe philosophy: anything ambiguous (no reference price, etc.) is a
*reject*, never a blind submit.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from trading.broker.base import Broker, risk_approval
from trading.config.settings import RiskLimits
from trading.core.logging_setup import get_logger
from trading.core.models import (
    Order,
    OrderType,
    Position,
    Side,
    Signal,
    utcnow,
)
from trading.persistence.repositories import NullRepository, Repository

log = get_logger(__name__)


@dataclass(frozen=True)
class RiskDecision:
    """The outcome of submitting a signal to the risk layer."""

    approved: bool
    reason: str
    order: Order | None = None
    checks: dict[str, str] = field(default_factory=dict)


class RiskLayer:
    """The mandatory pre-broker gate for every order."""

    def __init__(
        self,
        broker: Broker,
        limits: RiskLimits,
        repo: Repository | None = None,
        *,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._broker = broker
        self._limits = limits
        self._repo: Repository = repo if repo is not None else NullRepository()
        self._clock = clock

        self._kill_switch = False
        self._halted = False
        self._start_equity: Decimal | None = None
        self._prices: dict[str, Decimal] = {}
        self._order_times: deque[datetime] = deque()

    # -- external controls -------------------------------------------------
    @property
    def kill_switch_engaged(self) -> bool:
        return self._kill_switch

    @property
    def halted(self) -> bool:
        return self._halted

    def engage_kill_switch(self, *, flatten: bool = False) -> None:
        """Block all new orders. Optionally flatten every open position first."""
        if flatten:
            self.flatten_all(reason="kill_switch_flatten")
        self._kill_switch = True
        log.warning("kill_switch_engaged", flatten=flatten)

    def disengage_kill_switch(self) -> None:
        self._kill_switch = False
        log.warning("kill_switch_disengaged")

    def reset_daily(self) -> None:
        """Reset the daily-loss halt and re-baseline start-of-day equity."""
        self._halted = False
        self._order_times.clear()
        try:
            account = self._broker.get_account()
            self._start_equity = account.last_equity or account.equity
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("reset_daily_account_error", error=str(exc))
            self._start_equity = None
        log.info("risk_reset_daily", start_equity=str(self._start_equity))

    def update_price(self, symbol: str, price: Decimal) -> None:
        """Feed the latest reference price (used for notional checks + stops)."""
        self._prices[symbol] = price

    # -- introspection -----------------------------------------------------
    def daily_pnl(self) -> Decimal:
        account = self._broker.get_account()
        start = self._ensure_start_equity(account.last_equity or account.equity)
        return account.equity - start

    def _ensure_start_equity(self, fallback: Decimal) -> Decimal:
        if self._start_equity is None:
            self._start_equity = fallback
        return self._start_equity

    # -- the chokepoint ----------------------------------------------------
    def submit(self, signal: Signal) -> RiskDecision:
        """Run every check; if all pass, submit through the broker. Always logs."""
        self._repo.record_signal(signal)
        checks: dict[str, str] = {}

        account = self._broker.get_account()
        positions = {p.symbol: p for p in self._broker.get_positions()}
        self._ensure_start_equity(account.last_equity or account.equity)

        # Order matters: cheapest / most decisive checks first.
        evaluators: list[Callable[[Signal, dict[str, Position], object], tuple[str, bool, str]]] = [
            self._check_kill_switch,
            self._check_qty_positive,
            self._check_reference_price,
            self._check_daily_loss,
            self._check_order_notional,
            self._check_rate_limit,
            self._check_position_size,
            self._check_gross_exposure,
            self._check_buying_power,
        ]

        reject_reason = ""
        for evaluator in evaluators:
            name, ok, reason = evaluator(signal, positions, account)
            checks[name] = "ok" if ok else f"reject: {reason}"
            if not ok and not reject_reason:
                reject_reason = reason
                break  # fail fast -- fail safe

        if reject_reason:
            self._repo.record_risk_decision(
                signal, approved=False, reason=reject_reason, checks=checks
            )
            log.warning(
                "risk_rejected",
                symbol=signal.symbol,
                side=signal.side.value,
                qty=str(signal.qty),
                reason=reject_reason,
            )
            return RiskDecision(approved=False, reason=reject_reason, checks=checks)

        order = self._build_order(signal, positions)
        self._repo.record_order(order)
        try:
            with risk_approval():
                submitted = self._broker.submit_order(order)
        except Exception as exc:
            # Fail safe: a submission error halts -- never blind-retry.
            self._repo.record_risk_decision(
                signal, approved=False, reason=f"broker_error: {exc}", checks=checks
            )
            log.error("risk_submit_error", symbol=signal.symbol, error=str(exc))
            return RiskDecision(approved=False, reason=f"broker_error: {exc}", checks=checks)

        self._order_times.append(self._clock())
        self._repo.update_order(submitted)
        self._repo.record_risk_decision(
            signal,
            approved=True,
            reason="approved",
            checks=checks,
            client_order_id=submitted.client_order_id,
        )
        log.info(
            "risk_approved",
            symbol=order.symbol,
            side=order.side.value,
            qty=str(order.qty),
            stop=str(order.stop_loss_price) if order.stop_loss_price else None,
            broker_order_id=submitted.broker_order_id,
        )
        return RiskDecision(approved=True, reason="approved", order=submitted, checks=checks)

    def flatten_all(self, *, reason: str = "flatten") -> list[RiskDecision]:
        """Submit market exits for every open position (bypasses entry-only halts)."""
        decisions: list[RiskDecision] = []
        for pos in self._broker.get_positions():
            if pos.qty == 0:
                continue
            exit_side = Side.SELL if pos.qty > 0 else Side.BUY
            order = Order(
                symbol=pos.symbol,
                side=exit_side,
                qty=abs(pos.qty),
                type=OrderType.MARKET,
                reason=reason,
            )
            self._repo.record_order(order)
            try:
                with risk_approval():
                    submitted = self._broker.submit_order(order)
                self._repo.update_order(submitted)
                decisions.append(RiskDecision(approved=True, reason=reason, order=submitted))
                log.warning("risk_flatten", symbol=pos.symbol, qty=str(pos.qty))
            except Exception as exc:  # pragma: no cover - defensive
                log.error("risk_flatten_error", symbol=pos.symbol, error=str(exc))
                decisions.append(RiskDecision(approved=False, reason=f"flatten_error: {exc}"))
        return decisions

    # -- individual checks (each: (name, ok, reason)) ----------------------
    def _check_kill_switch(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        if self._kill_switch:
            return ("kill_switch", False, "kill switch engaged")
        return ("kill_switch", True, "")

    def _check_qty_positive(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        if signal.qty <= 0:
            return ("qty_positive", False, f"non-positive qty {signal.qty}")
        return ("qty_positive", True, "")

    def _check_reference_price(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        if self._reference_price(signal, positions) is None:
            return ("reference_price", False, "no reference price available")
        return ("reference_price", True, "")

    def _check_daily_loss(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        equity = account.equity  # type: ignore[attr-defined]
        start = self._ensure_start_equity(equity)
        pnl = equity - start
        if self._limits.daily_loss_limit > 0 and pnl <= -self._limits.daily_loss_limit:
            self._halted = True
        # A halt blocks new entries but always lets exits through.
        if self._halted and signal.is_entry:
            return ("daily_loss", False, f"daily loss halt (pnl={pnl})")
        return ("daily_loss", True, "")

    def _check_order_notional(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        price = self._reference_price(signal, positions)
        assert price is not None  # guaranteed by _check_reference_price
        notional = signal.qty * price
        ceiling = self._limits.max_order_notional
        if ceiling > 0 and notional > ceiling:
            return ("order_notional", False, f"order notional {notional} > {ceiling}")
        return ("order_notional", True, "")

    def _check_rate_limit(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        limit = self._limits.max_orders_per_minute
        if limit <= 0:
            return ("rate_limit", True, "")
        now = self._clock()
        cutoff = now - timedelta(seconds=60)
        while self._order_times and self._order_times[0] < cutoff:
            self._order_times.popleft()
        if len(self._order_times) >= limit:
            return ("rate_limit", False, f"{len(self._order_times)} orders in last 60s >= {limit}")
        return ("rate_limit", True, "")

    def _check_position_size(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        current = positions.get(signal.symbol)
        current_qty = current.qty if current else Decimal(0)
        delta = signal.qty * Decimal(signal.side.sign)
        projected = current_qty + delta
        increases = abs(projected) > abs(current_qty)
        if not increases:
            return ("position_size", True, "")  # reductions always allowed

        max_shares = self._limits.max_position_shares
        if max_shares > 0 and abs(projected) > max_shares:
            return ("position_size", False, f"position {abs(projected)} > {max_shares} shares")

        price = self._reference_price(signal, positions)
        assert price is not None
        max_notional = self._limits.max_position_notional
        if max_notional > 0 and abs(projected) * price > max_notional:
            return (
                "position_size",
                False,
                f"position notional {abs(projected) * price} > {max_notional}",
            )
        return ("position_size", True, "")

    def _check_gross_exposure(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        limit = self._limits.max_gross_exposure
        if limit <= 0:
            return ("gross_exposure", True, "")

        price = self._reference_price(signal, positions)
        assert price is not None
        current = positions.get(signal.symbol)
        current_qty = current.qty if current else Decimal(0)
        delta = signal.qty * Decimal(signal.side.sign)
        projected_qty = current_qty + delta

        # Recompute total gross with this symbol's projected value substituted.
        gross = Decimal(0)
        for sym, pos in positions.items():
            if sym == signal.symbol:
                continue
            mark = self._prices.get(sym, pos.current_price or pos.avg_price)
            gross += abs(pos.qty * mark)
        gross += abs(projected_qty * price)

        increases = abs(projected_qty) > abs(current_qty)
        if increases and gross > limit:
            return ("gross_exposure", False, f"gross exposure {gross} > {limit}")
        return ("gross_exposure", True, "")

    def _check_buying_power(
        self, signal: Signal, positions: dict[str, Position], account: object
    ) -> tuple[str, bool, str]:
        # Only entries that consume cash (buys) are constrained here.
        if not signal.is_entry:
            return ("buying_power", True, "")
        price = self._reference_price(signal, positions)
        assert price is not None
        cost = signal.qty * price
        bp = account.buying_power  # type: ignore[attr-defined]
        if cost > bp:
            return ("buying_power", False, f"cost {cost} > buying power {bp}")
        return ("buying_power", True, "")

    # -- helpers -----------------------------------------------------------
    def _reference_price(
        self, signal: Signal, positions: dict[str, Position]
    ) -> Decimal | None:
        if signal.limit_price is not None:
            return signal.limit_price
        if signal.stop_price is not None:
            return signal.stop_price
        if signal.symbol in self._prices:
            return self._prices[signal.symbol]
        pos = positions.get(signal.symbol)
        if pos is not None and pos.current_price is not None:
            return pos.current_price
        return None

    def _build_order(self, signal: Signal, positions: dict[str, Position]) -> Order:
        order = Order.from_signal(signal)
        # Attach a protective stop to entries that lack one (server-side at broker).
        if signal.is_entry and order.stop_loss_price is None and self._limits.stop_loss_pct > 0:
            price = self._reference_price(signal, positions)
            if price is not None:
                pct = self._limits.stop_loss_pct
                stop = (
                    price * (Decimal(1) - pct)
                    if signal.side is Side.BUY
                    else price * (Decimal(1) + pct)
                )
                order = order.with_updates(stop_loss_price=_round_cent(stop))
        return order


def _round_cent(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))
