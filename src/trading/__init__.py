"""Day-trader: infrastructure for US-equities day trading.

The package is organised as a left-to-right pipeline with the risk layer as a
mandatory gate::

    market data -> strategy -> risk layer -> broker

The *same* strategy and engine code runs in three modes -- backtest, paper and
live -- differing only in the injected data provider and broker.
"""

from __future__ import annotations

__version__ = "0.1.0"
