"""The engine: wires data -> strategy -> risk -> broker (BUILD_PLAN §6.8).

The same engine runs all three modes; only the injected data provider and broker
differ. Core event handlers (``handle_bar``, ``handle_quote``, ``on_fill``,
``on_order_update``) are shared. Two drivers feed them:

* :meth:`run_backtest` -- synchronous and deterministic, driven by a
  :class:`~trading.data.historical.HistoricalReplayProvider`.
* :meth:`run_live` -- a queue-based loop fed by websocket/callback threads, with
  reconnect-with-backoff and fail-safe handling of ambiguous conditions.

Fail-safe behaviour (BUILD_PLAN §2): on disconnect or unknown state the engine
pauses *new entries* and alerts; it never blind-retries order submission. All
order submission goes through the risk layer -- the engine never calls
``broker.submit_order``.
"""

from __future__ import annotations

import queue
import time
from collections.abc import Sequence
from decimal import Decimal

from trading.broker.base import Broker
from trading.core.events import (
    BarEvent,
    ConnectionEvent,
    Event,
    EventType,
    FillEvent,
    OrderUpdateEvent,
    QuoteEvent,
    SessionEvent,
    SessionPhase,
    ShutdownEvent,
)
from trading.core.logging_setup import get_logger
from trading.core.models import (
    Account,
    Bar,
    Fill,
    Order,
    Position,
    Quote,
)
from trading.data.base import MarketDataProvider
from trading.persistence.repositories import NullRepository, Repository
from trading.risk.risk_layer import RiskLayer
from trading.strategy.base import Strategy, StrategyContext

log = get_logger(__name__)

_BACKOFF_SCHEDULE = (2.0, 4.0, 8.0, 16.0)


class Engine:
    """Event loop connecting market data, strategy, risk layer and broker."""

    def __init__(
        self,
        strategy: Strategy,
        risk: RiskLayer,
        broker: Broker,
        data: MarketDataProvider,
        symbols: Sequence[str],
        timeframe: str = "1Min",
        repo: Repository | None = None,
    ) -> None:
        self.strategy = strategy
        self.risk = risk
        self.broker = broker
        self.data = data
        self.symbols = [s.upper() for s in symbols]
        self.timeframe = timeframe
        self.repo: Repository = repo if repo is not None else NullRepository()

        self._positions: dict[str, Position] = {}
        self._account: Account | None = None
        self._prices: dict[str, Decimal] = {}
        self._open_orders: dict[str, Order] = {}

        self._queue: queue.Queue[Event] = queue.Queue()
        self._running = False
        self._trading_paused = False  # set on disconnect (fail safe)
        self._snapshot_every = 1
        self._bars_seen = 0

    # =====================================================================
    # Shared event handlers
    # =====================================================================
    def handle_bar(self, bar: Bar) -> None:
        # 1. Let a simulated broker mark prices and trigger resting stops first.
        self.broker.on_bar(bar)
        # 2. Publish the reference price to the engine + risk layer.
        self._prices[bar.symbol] = bar.close
        self.risk.update_price(bar.symbol, bar.close)
        # 3. Refresh account/position view used to build the strategy context.
        self._refresh_state()
        # 4. Ask the strategy for intent.
        context = self._context()
        signal = self.strategy.on_bar(bar, context)
        if signal is not None:
            if self._trading_paused and signal.is_entry:
                log.warning("entry_suppressed_paused", symbol=signal.symbol)
            else:
                self.risk.submit(signal)
        # 5. Persist an equity snapshot for the equity curve.
        self._bars_seen += 1
        if self._bars_seen % self._snapshot_every == 0:
            self._snapshot_equity(ts=bar.ts)

    def handle_quote(self, quote: Quote) -> None:
        self._prices[quote.symbol] = quote.mid
        self.risk.update_price(quote.symbol, quote.mid)
        context = self._context()
        signal = self.strategy.on_quote(quote, context)
        if signal is not None and not (self._trading_paused and signal.is_entry):
            self.risk.submit(signal)

    def on_order_update(self, order: Order) -> None:
        self.repo.update_order(order)
        if order.is_terminal:
            self._open_orders.pop(order.client_order_id, None)
        else:
            self._open_orders[order.client_order_id] = order
        if order.status.value == "rejected":
            # Fail safe: surface rejections; do not auto-resubmit.
            log.error("order_rejected", symbol=order.symbol, reason=order.reason)

    def on_fill(self, fill: Fill) -> None:
        self.repo.record_fill(fill)
        log.info(
            "fill",
            symbol=fill.symbol,
            side=fill.side.value,
            qty=str(fill.qty),
            price=str(fill.price),
        )
        # Reconcile position/account view from the broker (source of truth).
        self._refresh_state()

    # =====================================================================
    # Backtest driver (synchronous, deterministic)
    # =====================================================================
    def run_backtest(self) -> None:
        """Drive the engine over the injected replay provider, in time order."""
        if not hasattr(self.data, "iter_bars"):
            raise TypeError("run_backtest requires a HistoricalReplayProvider-like data source")
        self.broker.set_event_sink(self.on_order_update, self.on_fill)
        self.risk.reset_daily()
        self.strategy.on_start()
        self._running = True
        log.info("backtest_start", symbols=self.symbols, timeframe=self.timeframe)
        try:
            for bar in self.data.iter_bars(self.symbols):
                if not self._running:
                    break
                self.handle_bar(bar)
        finally:
            self.strategy.on_stop()
            self._refresh_state()
            self._snapshot_equity()
            self._running = False
        log.info("backtest_complete", bars=self._bars_seen)

    # =====================================================================
    # Live / paper driver (queue-based, threaded)
    # =====================================================================
    def run_live(self) -> None:
        """Run against streaming data + a real broker until stopped."""
        self.broker.set_event_sink(
            on_order_update=lambda o: self._queue.put(OrderUpdateEvent.of(o)),
            on_fill=lambda f: self._queue.put(FillEvent.of(f)),
        )
        self.data.stream_bars(
            self.symbols, self.timeframe, lambda b: self._queue.put(BarEvent.of(b))
        )
        self.data.stream_quotes(self.symbols, lambda q: self._queue.put(QuoteEvent.of(q)))

        self.risk.reset_daily()
        self.strategy.on_start()
        self._running = True
        self._refresh_state()
        self.broker.start()
        self.data.start()
        log.info("live_start", symbols=self.symbols, timeframe=self.timeframe)

        try:
            self._loop()
        except KeyboardInterrupt:  # pragma: no cover - interactive
            log.warning("keyboard_interrupt")
        finally:
            self.shutdown()

    def _loop(self) -> None:
        while self._running:
            try:
                event = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            self._dispatch(event)

    def _dispatch(self, event: Event) -> None:
        if event.type is EventType.BAR and isinstance(event, BarEvent) and event.bar:
            self.handle_bar(event.bar)
        elif event.type is EventType.QUOTE and isinstance(event, QuoteEvent) and event.quote:
            self.handle_quote(event.quote)
        elif event.type is EventType.FILL and isinstance(event, FillEvent) and event.fill:
            self.on_fill(event.fill)
        elif (
            event.type is EventType.ORDER_UPDATE
            and isinstance(event, OrderUpdateEvent)
            and event.order
        ):
            self.on_order_update(event.order)
        elif event.type is EventType.CONNECTION and isinstance(event, ConnectionEvent):
            self._handle_connection(event)
        elif event.type is EventType.SESSION and isinstance(event, SessionEvent):
            self._handle_session(event)
        elif event.type is EventType.SHUTDOWN:
            self._running = False

    def _handle_connection(self, event: ConnectionEvent) -> None:
        if event.connected:
            log.info("reconnected", detail=event.detail)
            self._trading_paused = False
            self._refresh_state()
        else:
            # Fail safe: stop initiating new trades; protective stops remain at
            # the broker. Attempt to reconnect with exponential backoff.
            log.error("disconnected", detail=event.detail)
            self._trading_paused = True
            self._reconnect_with_backoff()

    def _handle_session(self, event: SessionEvent) -> None:
        log.info("session_phase", phase=event.phase.value)
        if event.phase is SessionPhase.OPEN:
            self.risk.reset_daily()
            self._trading_paused = False
        elif event.phase is SessionPhase.CLOSED:
            self._trading_paused = True

    def _reconnect_with_backoff(self) -> None:
        for delay in _BACKOFF_SCHEDULE:
            if not self._running:
                return
            log.warning("reconnect_attempt", delay=delay)
            time.sleep(delay)
            try:
                self.data.stop()
                self.data.start()
                self._queue.put(ConnectionEvent.of(True, detail="reconnect ok"))
                return
            except Exception as exc:  # pragma: no cover - network path
                log.error("reconnect_failed", error=str(exc))
        log.error("reconnect_exhausted")

    def stop(self, reason: str = "") -> None:
        """Request a graceful shutdown from another thread."""
        self._queue.put(ShutdownEvent.of(reason))

    def shutdown(self) -> None:
        """Stop streams and snapshot final state. Does not orphan positions."""
        if not self._running:
            return
        self._running = False
        log.info("engine_shutdown")
        try:
            self.data.stop()
        except Exception as exc:  # pragma: no cover
            log.warning("data_stop_error", error=str(exc))
        try:
            self.broker.stop()
        except Exception as exc:  # pragma: no cover
            log.warning("broker_stop_error", error=str(exc))
        self.strategy.on_stop()
        self._refresh_state()
        self._snapshot_equity()

    # =====================================================================
    # State helpers
    # =====================================================================
    def _refresh_state(self) -> None:
        try:
            self._positions = {p.symbol: p for p in self.broker.get_positions()}
            self._account = self.broker.get_account()
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("state_refresh_error", error=str(exc))

    def _context(self) -> StrategyContext:
        return StrategyContext(account=self._account, positions=dict(self._positions))

    def _snapshot_equity(self, ts: object = None) -> None:
        if self._account is None:
            return
        unrealized = sum((p.unrealized_pnl for p in self._positions.values()), Decimal(0))
        realized = Decimal(str(getattr(self.broker, "realized_pnl", Decimal(0))))
        self.repo.record_equity_snapshot(
            self._account,
            realized_pnl=realized,
            unrealized_pnl=unrealized,
            ts=ts,  # type: ignore[arg-type]
        )

    # -- introspection -----------------------------------------------------
    @property
    def positions(self) -> dict[str, Position]:
        return dict(self._positions)

    @property
    def account(self) -> Account | None:
        return self._account
