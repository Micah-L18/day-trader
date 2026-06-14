"""Engine tests using simulated providers only -- no network (BUILD_PLAN §8)."""

from __future__ import annotations

from decimal import Decimal

from conftest import make_limits
from trading.backtest.synthetic import trending_bars
from trading.broker.paper_sim import SimulatedBroker
from trading.core.events import ConnectionEvent
from trading.core.models import OrderType, Side, Signal
from trading.data.historical import HistoricalReplayProvider
from trading.engine.engine import Engine
from trading.persistence.db import EquitySnapshotRow, FillRow
from trading.persistence.repositories import SqlRepository
from trading.risk.risk_layer import RiskLayer
from trading.strategy.base import Strategy, StrategyContext


class BuyOnce(Strategy):
    def __init__(self, symbols: list[str]) -> None:
        super().__init__(symbols)
        self.bought = False

    def on_bar(self, bar, context: StrategyContext) -> Signal | None:  # type: ignore[override]
        if not self.bought:
            self.bought = True
            return Signal(bar.symbol, Side.BUY, Decimal("10"), OrderType.MARKET)
        return None


def _engine(
    strategy: Strategy, broker: SimulatedBroker, bars, repo: SqlRepository, limits=None
) -> Engine:
    data = HistoricalReplayProvider.from_bars(bars)
    risk = RiskLayer(broker, limits or make_limits(), repo)
    return Engine(strategy, risk, broker, data, ["AAPL"], "1Min", repo)


# Disable the auto-stop so a held position isn't stopped out mid-backtest.
_NO_STOP = make_limits(stop_loss_pct=Decimal("0"))


def test_backtest_executes_and_persists(db) -> None:
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, trending_bars("AAPL", 20), repo, _NO_STOP)
    engine.run_backtest()

    pos = engine.positions.get("AAPL")
    assert pos is not None and pos.qty == Decimal("10")
    assert repo.count(FillRow) >= 1
    assert repo.count(EquitySnapshotRow) >= 1
    assert engine.account is not None


def test_engine_reconciles_position_from_broker(db) -> None:
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, trending_bars("AAPL", 10), repo, _NO_STOP)
    engine.run_backtest()
    # Engine's cached view matches the broker's truth.
    assert engine.positions["AAPL"].qty == broker.get_position("AAPL").qty  # type: ignore[union-attr]


def test_auto_stop_protects_position_on_downtrend(db) -> None:
    # With the default 2% auto-stop, a held long is stopped out as price falls.
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, trending_bars("AAPL", 20), repo)
    engine.run_backtest()
    assert engine.positions.get("AAPL") is None  # protective stop fired


def test_engine_exposes_history_for_ui(db) -> None:
    # The UI renders from these in-memory buffers (no DB round-trips).
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, trending_bars("AAPL", 15), repo, _NO_STOP)
    engine.run_backtest()
    assert len(engine.equity_history) >= 1
    assert len(engine.recent_fills) >= 1
    _ts, equity = engine.equity_history[-1]
    assert engine.account is not None
    assert equity == engine.account.equity


def test_paused_trading_suppresses_entries(db) -> None:
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, [], repo)
    engine.broker.set_event_sink(engine.on_order_update, engine.on_fill)
    engine._trading_paused = True

    bar = trending_bars("AAPL", 1)[0]
    engine.handle_bar(bar)
    assert broker.get_position("AAPL") is None  # entry was suppressed


def test_connection_event_toggles_pause(db) -> None:
    repo = SqlRepository(db)
    broker = SimulatedBroker(Decimal("100000"))
    engine = _engine(BuyOnce(["AAPL"]), broker, [], repo)
    engine._handle_connection(ConnectionEvent.of(False, "drop"))
    assert engine._trading_paused
    engine._handle_connection(ConnectionEvent.of(True, "up"))
    assert not engine._trading_paused
