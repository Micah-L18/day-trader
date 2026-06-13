"""Construct providers/brokers/engine from :class:`Settings`.

Keeps mode-specific wiring in one place so the CLI/UI don't repeat it. Alpaca
adapters are imported lazily so a backtest works without the optional SDK.
"""

from __future__ import annotations

from trading.broker.base import Broker
from trading.broker.paper_sim import SimulatedBroker
from trading.config.settings import Settings
from trading.data.base import MarketDataProvider
from trading.engine.engine import Engine
from trading.persistence.db import Database
from trading.persistence.repositories import SqlRepository
from trading.risk.risk_layer import RiskLayer
from trading.strategy.base import Strategy


def build_broker(settings: Settings) -> Broker:
    if settings.is_backtest:
        return SimulatedBroker()
    from trading.broker.alpaca import AlpacaBroker

    key, secret = settings.require_alpaca_credentials()
    return AlpacaBroker(key, secret, paper=settings.alpaca_paper)


def build_data_provider(settings: Settings) -> MarketDataProvider:
    from trading.data.alpaca import AlpacaDataProvider

    key, secret = settings.require_alpaca_credentials()
    return AlpacaDataProvider(key, secret, feed=settings.alpaca_data_feed.value)


def build_engine(
    settings: Settings,
    strategy: Strategy,
    *,
    broker: Broker | None = None,
    data: MarketDataProvider | None = None,
) -> tuple[Engine, Database]:
    """Build a fully-wired engine for paper/live. Returns ``(engine, db)``.

    The caller owns ``db`` and should ``db.dispose()`` when done.
    """
    db = Database(settings.db_path)
    repo = SqlRepository(db)
    broker = broker or build_broker(settings)
    data = data or build_data_provider(settings)
    risk = RiskLayer(broker, settings.risk, repo)
    engine = Engine(
        strategy=strategy,
        risk=risk,
        broker=broker,
        data=data,
        symbols=settings.symbols,
        timeframe=settings.timeframe,
        repo=repo,
    )
    return engine, db


__all__ = ["build_broker", "build_data_provider", "build_engine"]
