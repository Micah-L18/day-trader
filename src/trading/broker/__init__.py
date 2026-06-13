"""Broker adapters behind one interface (BUILD_PLAN §6.4)."""

from trading.broker.base import (
    Broker,
    FillCallback,
    OrderUpdateCallback,
    risk_approval,
)
from trading.broker.paper_sim import SimulatedBroker

__all__ = [
    "Broker",
    "FillCallback",
    "OrderUpdateCallback",
    "SimulatedBroker",
    "risk_approval",
]
