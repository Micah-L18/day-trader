"""Local fill simulator used for backtests (BUILD_PLAN §6, broker/paper_sim.py).

A deterministic, in-memory broker:

* Market orders fill immediately at the latest bar's close (+ optional slippage).
* Limit/stop orders rest and trigger against subsequent bars' high/low.
* When an entry carries ``stop_loss_price`` (and/or ``take_profit_price``) the
  simulator attaches a protective bracket and treats stop+target as OCO -- the
  same server-side-stop behaviour the live broker provides.

Cash-account accounting (no margin) is used by default; equity, realised and
unrealised P&L are tracked so the risk layer and backtest metrics have real
numbers to work with.

Known simplification: a market order placed while handling a bar fills at that
bar's close (decision and fill share the bar). This introduces minor look-ahead;
fill timing can be refined later without touching the engine/strategy.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from decimal import Decimal

from trading.broker.base import Broker
from trading.core.logging_setup import get_logger
from trading.core.models import (
    Account,
    Bar,
    Fill,
    Order,
    OrderStatus,
    OrderType,
    Position,
    Side,
    utcnow,
)

log = get_logger(__name__)


@dataclass
class _PosState:
    qty: Decimal = Decimal(0)
    avg: Decimal = Decimal(0)


@dataclass
class _Resting:
    order: Order
    group: int | None = None  # OCO/bracket group id


class SimulatedBroker(Broker):
    """In-memory broker that simulates fills from bar data."""

    def __init__(
        self,
        starting_cash: Decimal | float | str = Decimal("100000"),
        *,
        slippage_pct: Decimal | float | str = Decimal("0"),
        fee_per_share: Decimal | float | str = Decimal("0"),
    ) -> None:
        super().__init__()
        self._starting_cash = Decimal(str(starting_cash))
        self._cash = Decimal(str(starting_cash))
        self._slippage = Decimal(str(slippage_pct))
        self._fee_per_share = Decimal(str(fee_per_share))

        self._positions: dict[str, _PosState] = {}
        self._last_price: dict[str, Decimal] = {}
        self._orders: dict[str, Order] = {}
        self._resting: list[_Resting] = []
        self._realized_pnl = Decimal(0)
        self._clock = utcnow()
        self._ids = itertools.count(1)
        self._groups = itertools.count(1)

    # -- helpers -----------------------------------------------------------
    def _next_order_id(self) -> str:
        return f"sim-{next(self._ids)}"

    @property
    def realized_pnl(self) -> Decimal:
        return self._realized_pnl

    def _equity(self) -> Decimal:
        mtm = sum(
            (st.qty * self._last_price.get(sym, st.avg) for sym, st in self._positions.items()),
            Decimal(0),
        )
        return self._cash + mtm

    # -- Broker: account/positions ----------------------------------------
    def get_account(self) -> Account:
        equity = self._equity()
        return Account(
            equity=equity,
            buying_power=max(self._cash, Decimal(0)),
            cash=self._cash,
            last_equity=self._starting_cash,
            ts=self._clock,
        )

    def get_positions(self) -> list[Position]:
        out: list[Position] = []
        for sym, st in self._positions.items():
            if st.qty == 0:
                continue
            price = self._last_price.get(sym, st.avg)
            unrealized = (price - st.avg) * st.qty
            out.append(
                Position(
                    symbol=sym,
                    qty=st.qty,
                    avg_price=st.avg,
                    current_price=price,
                    unrealized_pnl=unrealized,
                )
            )
        return out

    # -- Broker: orders ----------------------------------------------------
    def submit_order(self, order: Order) -> Order:
        self._assert_risk_approved()
        oid = self._next_order_id()
        working = order.with_updates(
            broker_order_id=oid,
            status=OrderStatus.NEW,
            submitted_at=self._clock,
            updated_at=self._clock,
        )
        self._orders[oid] = working
        self._emit_order_update(working)

        if working.type is OrderType.MARKET:
            price = self._last_price.get(working.symbol)
            if price is None:
                rejected = working.with_updates(
                    status=OrderStatus.REJECTED, reason="no market data", updated_at=self._clock
                )
                self._orders[oid] = rejected
                self._emit_order_update(rejected)
                log.warning("sim_reject_no_price", symbol=working.symbol)
                return rejected
            fill_price = self._apply_slippage(working.side, price)
            return self._fill(working, fill_price, working.qty, attach_bracket=True)

        # Limit / stop orders rest until triggered by a future bar.
        self._resting.append(_Resting(order=working))
        return working

    def cancel_order(self, order_id: str) -> None:
        self._resting = [r for r in self._resting if r.order.broker_order_id != order_id]
        existing = self._orders.get(order_id)
        if existing is not None and existing.status.is_open:
            canceled = existing.with_updates(status=OrderStatus.CANCELED, updated_at=self._clock)
            self._orders[order_id] = canceled
            self._emit_order_update(canceled)

    def get_orders(self, status: str | None = None) -> list[Order]:
        orders = list(self._orders.values())
        if status is None:
            return orders
        if status == "open":
            return [o for o in orders if o.status.is_open]
        if status == "closed":
            return [o for o in orders if o.status.is_terminal]
        return [o for o in orders if o.status.value == status]

    # -- market-data driven simulation ------------------------------------
    def on_bar(self, bar: Bar) -> None:
        self._clock = bar.ts
        self._last_price[bar.symbol] = bar.close
        # Iterate a snapshot; fills mutate self._resting.
        for resting in [r for r in self._resting if r.order.symbol == bar.symbol]:
            if resting not in self._resting:
                continue  # already removed (e.g. OCO sibling)
            triggered, fill_price = self._check_trigger(resting.order, bar)
            if triggered:
                self._resting.remove(resting)
                self._cancel_group(resting.group, exclude=resting.order.broker_order_id)
                self._fill(resting.order, fill_price, resting.order.remaining_qty)

    # -- internals ---------------------------------------------------------
    def _apply_slippage(self, side: Side, price: Decimal) -> Decimal:
        if self._slippage == 0:
            return price
        factor = Decimal(1) + (self._slippage * Decimal(side.sign))
        return price * factor

    def _check_trigger(self, order: Order, bar: Bar) -> tuple[bool, Decimal]:
        """Return ``(triggered, fill_price)`` for a resting order against a bar."""
        if order.type is OrderType.LIMIT and order.limit_price is not None:
            lp = order.limit_price
            if order.side is Side.BUY and bar.low <= lp:
                return True, min(lp, bar.open) if bar.open <= lp else lp
            if order.side is Side.SELL and bar.high >= lp:
                return True, max(lp, bar.open) if bar.open >= lp else lp
        elif order.type in (OrderType.STOP, OrderType.STOP_LIMIT) and order.stop_price is not None:
            sp = order.stop_price
            # Sell stop (protect a long): triggers when price falls to the stop.
            if order.side is Side.SELL and bar.low <= sp:
                return True, min(sp, bar.open)  # gap-down fills at the open
            # Buy stop (protect a short): triggers when price rises to the stop.
            if order.side is Side.BUY and bar.high >= sp:
                return True, max(sp, bar.open)
        return False, Decimal(0)

    def _cancel_group(self, group: int | None, *, exclude: str | None) -> None:
        if group is None:
            return
        for resting in [r for r in self._resting if r.group == group]:
            if resting.order.broker_order_id == exclude:
                continue
            self._resting.remove(resting)
            self.cancel_order(resting.order.broker_order_id or "")

    def _fill(
        self, order: Order, price: Decimal, qty: Decimal, *, attach_bracket: bool = False
    ) -> Order:
        self._apply_position(order.symbol, order.side, qty, price)
        fee = self._fee_per_share * qty
        if fee:
            self._cash -= fee

        fill = Fill(
            order_id=order.broker_order_id or order.client_order_id,
            symbol=order.symbol,
            side=order.side,
            qty=qty,
            price=price,
            ts=self._clock,
            fee=fee,
        )
        filled = order.with_updates(
            status=OrderStatus.FILLED,
            filled_qty=order.filled_qty + qty,
            filled_avg_price=price,
            updated_at=self._clock,
        )
        if filled.broker_order_id:
            self._orders[filled.broker_order_id] = filled
        self._emit_fill(fill)
        self._emit_order_update(filled)

        if attach_bracket:
            self._attach_bracket(filled, qty)
        return filled

    def _attach_bracket(self, entry: Order, qty: Decimal) -> None:
        """Rest a protective stop (and optional target) opposite the entry."""
        if entry.stop_loss_price is None and entry.take_profit_price is None:
            return
        group = next(self._groups)
        exit_side = entry.side.opposite
        if entry.stop_loss_price is not None:
            stop = Order(
                symbol=entry.symbol,
                side=exit_side,
                qty=qty,
                type=OrderType.STOP,
                stop_price=entry.stop_loss_price,
                status=OrderStatus.NEW,
                broker_order_id=self._next_order_id(),
                submitted_at=self._clock,
                updated_at=self._clock,
                reason="protective_stop",
                strategy_id=entry.strategy_id,
            )
            self._orders[stop.broker_order_id] = stop  # type: ignore[index]
            self._resting.append(_Resting(order=stop, group=group))
            self._emit_order_update(stop)
        if entry.take_profit_price is not None:
            target = Order(
                symbol=entry.symbol,
                side=exit_side,
                qty=qty,
                type=OrderType.LIMIT,
                limit_price=entry.take_profit_price,
                status=OrderStatus.NEW,
                broker_order_id=self._next_order_id(),
                submitted_at=self._clock,
                updated_at=self._clock,
                reason="take_profit",
                strategy_id=entry.strategy_id,
            )
            self._orders[target.broker_order_id] = target  # type: ignore[index]
            self._resting.append(_Resting(order=target, group=group))
            self._emit_order_update(target)

    def _apply_position(self, symbol: str, side: Side, qty: Decimal, price: Decimal) -> None:
        st = self._positions.setdefault(symbol, _PosState())
        signed = qty * Decimal(side.sign)
        # Cash flow.
        self._cash -= signed * price  # buy reduces cash, sell increases it

        new_qty = st.qty + signed
        if st.qty != 0 and (st.qty > 0) != (signed > 0):
            # Reducing, closing, or flipping an existing position.
            closing = min(abs(signed), abs(st.qty))
            direction = Decimal(1) if st.qty > 0 else Decimal(-1)
            self._realized_pnl += closing * (price - st.avg) * direction
            if abs(signed) > abs(st.qty):
                # Flipped: remainder opens a fresh position at the fill price.
                st.qty = new_qty
                st.avg = price
            else:
                st.qty = new_qty
                if st.qty == 0:
                    st.avg = Decimal(0)
        else:
            # Increasing or opening: weighted-average the entry price.
            total_cost = st.avg * abs(st.qty) + price * qty
            st.qty = new_qty
            st.avg = total_cost / abs(new_qty) if new_qty != 0 else Decimal(0)

        if st.qty == 0:
            self._positions.pop(symbol, None)
