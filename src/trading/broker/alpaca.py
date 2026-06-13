"""Alpaca broker via ``alpaca-py`` (BUILD_PLAN §6.4).

Defaults to the **paper** endpoint; only a live ``Settings`` (mode=live with the
``ALLOW_LIVE_TRADING`` interlock) flips ``paper=False`` upstream. Protective stops
are attached *server-side* via Alpaca bracket/OTO orders so positions remain
protected if this app crashes.

``alpaca-py`` is an optional dependency; everything lazy-imports it.
"""

from __future__ import annotations

import threading
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal

from trading.broker.base import Broker
from trading.core.logging_setup import get_logger
from trading.core.models import (
    Account,
    Fill,
    Order,
    OrderStatus,
    OrderType,
    Position,
    Side,
    TimeInForce,
    to_decimal,
    utcnow,
)

log = get_logger(__name__)

_STATUS_MAP = {
    "new": OrderStatus.NEW,
    "accepted": OrderStatus.NEW,
    "pending_new": OrderStatus.PENDING,
    "accepted_for_bidding": OrderStatus.NEW,
    "partially_filled": OrderStatus.PARTIALLY_FILLED,
    "filled": OrderStatus.FILLED,
    "canceled": OrderStatus.CANCELED,
    "pending_cancel": OrderStatus.NEW,
    "expired": OrderStatus.EXPIRED,
    "rejected": OrderStatus.REJECTED,
    "done_for_day": OrderStatus.NEW,
    "replaced": OrderStatus.NEW,
    "stopped": OrderStatus.NEW,
    "suspended": OrderStatus.NEW,
}


def _require_alpaca() -> None:
    try:
        import alpaca  # noqa: F401
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "alpaca-py is not installed. Install the optional extra: "
            "pip install -e '.[alpaca]'"
        ) from exc


def _map_status(raw: object) -> OrderStatus:
    value = getattr(raw, "value", raw)
    return _STATUS_MAP.get(str(value).lower(), OrderStatus.NEW)


def _as_datetime(value: object) -> datetime | None:
    return value if isinstance(value, datetime) else None


class AlpacaBroker(Broker):
    """Order routing + account/position reads against Alpaca."""

    def __init__(self, api_key: str, secret_key: str, *, paper: bool = True) -> None:
        super().__init__()
        _require_alpaca()
        from alpaca.trading.client import TradingClient

        self._paper = paper
        self._client = TradingClient(api_key, secret_key, paper=paper)
        self._api_key = api_key
        self._secret_key = secret_key
        self._stream: object | None = None
        self._thread: threading.Thread | None = None

    # -- account / positions ----------------------------------------------
    def get_account(self) -> Account:
        a = self._client.get_account()
        return Account(
            equity=to_decimal(a.equity),
            buying_power=to_decimal(a.buying_power),
            cash=to_decimal(a.cash),
            last_equity=to_decimal(a.last_equity) if a.last_equity is not None else None,
        )

    def get_positions(self) -> list[Position]:
        out: list[Position] = []
        for p in self._client.get_all_positions():
            out.append(
                Position(
                    symbol=p.symbol,
                    qty=to_decimal(p.qty),
                    avg_price=to_decimal(p.avg_entry_price),
                    current_price=to_decimal(p.current_price) if p.current_price else None,
                    unrealized_pnl=to_decimal(p.unrealized_pl) if p.unrealized_pl else Decimal(0),
                )
            )
        return out

    # -- orders ------------------------------------------------------------
    def submit_order(self, order: Order) -> Order:
        self._assert_risk_approved()
        request = self._build_request(order)
        resp = self._client.submit_order(request)
        submitted = self._convert_order(resp, fallback=order)
        log.info(
            "alpaca_order_submitted",
            symbol=order.symbol,
            side=order.side.value,
            qty=str(order.qty),
            broker_order_id=submitted.broker_order_id,
            has_stop=order.stop_loss_price is not None,
        )
        return submitted

    def cancel_order(self, order_id: str) -> None:
        self._client.cancel_order_by_id(order_id)

    def get_orders(self, status: str | None = None) -> list[Order]:
        from alpaca.trading.enums import QueryOrderStatus
        from alpaca.trading.requests import GetOrdersRequest

        status_map = {
            "open": QueryOrderStatus.OPEN,
            "closed": QueryOrderStatus.CLOSED,
            None: QueryOrderStatus.ALL,
        }
        req = GetOrdersRequest(status=status_map.get(status, QueryOrderStatus.ALL))
        return [self._convert_order(o) for o in self._client.get_orders(filter=req)]

    # -- trade-update stream ----------------------------------------------
    def start(self) -> None:
        from alpaca.trading.stream import TradingStream

        stream = TradingStream(self._api_key, self._secret_key, paper=self._paper)
        self._stream = stream

        async def _on_update(data: object) -> None:
            self._handle_trade_update(data)

        stream.subscribe_trade_updates(_on_update)

        def _run() -> None:
            try:
                stream.run()
            except Exception as exc:  # pragma: no cover
                log.error("alpaca_trade_stream_error", error=str(exc))

        self._thread = threading.Thread(target=_run, name="alpaca-trade-stream", daemon=True)
        self._thread.start()
        log.info("alpaca_trade_stream_started", paper=self._paper)

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()  # type: ignore[attr-defined]
            except Exception as exc:  # pragma: no cover
                log.warning("alpaca_trade_stream_stop_error", error=str(exc))
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=5)

    def _handle_trade_update(self, data: object) -> None:
        event = str(getattr(data, "event", "")).lower()
        raw_order = getattr(data, "order", None)
        if raw_order is not None:
            self._emit_order_update(self._convert_order(raw_order))
        if event in {"fill", "partial_fill"} and raw_order is not None:
            price = getattr(data, "price", None)
            qty = getattr(data, "qty", None)
            fill = Fill(
                order_id=str(getattr(raw_order, "id", "")),
                symbol=getattr(raw_order, "symbol", ""),
                side=Side(str(getattr(raw_order, "side", "buy")).lower()),
                qty=to_decimal(qty) if qty is not None else Decimal(0),
                price=to_decimal(price) if price is not None else Decimal(0),
                ts=utcnow(),
            )
            self._emit_fill(fill)

    # -- conversions -------------------------------------------------------
    def _build_request(self, order: Order) -> object:
        from alpaca.trading.enums import OrderClass, OrderSide
        from alpaca.trading.enums import TimeInForce as AlpacaTIF
        from alpaca.trading.requests import (
            LimitOrderRequest,
            MarketOrderRequest,
            StopLossRequest,
            StopOrderRequest,
            TakeProfitRequest,
        )

        side = OrderSide.BUY if order.side is Side.BUY else OrderSide.SELL
        tif = getattr(AlpacaTIF, order.time_in_force.name, AlpacaTIF.DAY)

        # Determine bracket/OTO class from attached protective levels.
        order_class = OrderClass.SIMPLE
        kwargs: dict[str, object] = {}
        if order.stop_loss_price is not None and order.take_profit_price is not None:
            order_class = OrderClass.BRACKET
            kwargs["stop_loss"] = StopLossRequest(stop_price=float(order.stop_loss_price))
            kwargs["take_profit"] = TakeProfitRequest(limit_price=float(order.take_profit_price))
        elif order.stop_loss_price is not None:
            order_class = OrderClass.OTO
            kwargs["stop_loss"] = StopLossRequest(stop_price=float(order.stop_loss_price))
        elif order.take_profit_price is not None:
            order_class = OrderClass.OTO
            kwargs["take_profit"] = TakeProfitRequest(limit_price=float(order.take_profit_price))

        common = {
            "symbol": order.symbol,
            "qty": float(order.qty),
            "side": side,
            "time_in_force": tif,
            "client_order_id": order.client_order_id,
            "order_class": order_class,
            **kwargs,
        }

        if order.type is OrderType.MARKET:
            return MarketOrderRequest(**common)
        if order.type is OrderType.LIMIT:
            return LimitOrderRequest(limit_price=float(order.limit_price or 0), **common)
        if order.type in (OrderType.STOP, OrderType.STOP_LIMIT):
            return StopOrderRequest(stop_price=float(order.stop_price or 0), **common)
        raise ValueError(f"Unsupported order type: {order.type}")

    def _convert_order(self, raw: object, *, fallback: Order | None = None) -> Order:
        def g(name: str, default: object = None) -> object:
            return getattr(raw, name, default)

        filled_qty = to_decimal(g("filled_qty", 0) or 0)
        filled_avg = g("filled_avg_price", None)
        side = Side(str(g("side", "buy")).lower())
        type_value = str(g("order_type", g("type", "market"))).lower()
        try:
            otype = OrderType(type_value)
        except ValueError:
            otype = OrderType.MARKET
        return Order(
            symbol=str(g("symbol", fallback.symbol if fallback else "")),
            side=side,
            qty=to_decimal(g("qty", fallback.qty if fallback else 0) or 0),
            type=otype,
            status=_map_status(g("status", "new")),
            limit_price=to_decimal(g("limit_price")) if g("limit_price") else None,
            stop_price=to_decimal(g("stop_price")) if g("stop_price") else None,
            filled_qty=filled_qty,
            filled_avg_price=to_decimal(filled_avg) if filled_avg else None,
            client_order_id=str(g("client_order_id", fallback.client_order_id if fallback else "")),
            broker_order_id=str(g("id")) if g("id") else None,
            submitted_at=_as_datetime(g("submitted_at") or g("created_at")),
            updated_at=_as_datetime(g("updated_at")) or utcnow(),
            time_in_force=fallback.time_in_force if fallback else TimeInForce.DAY,
        )

    def get_account_symbols(self, symbols: Sequence[str]) -> None:  # pragma: no cover
        """Reserved for future per-symbol queries."""
        return None


__all__ = ["AlpacaBroker"]
