"""PySide6 desktop monitor + kill switch (BUILD_PLAN §6.10, Phase 5).

Scaffold for the desktop UI: a live positions/P&L table, an equity readout, a
mode indicator and a prominent **kill-switch** button wired to
``RiskLayer.engage_kill_switch``. The engine runs on a background thread; a timer
polls engine/risk state to refresh the view.

PySide6 is an *optional* dependency (``pip install -e '.[ui]'``). This module
imports without it; only :func:`main` / :class:`TradingWindow` need it.

Status: minimal but functional scaffold. Phase 5 hardening (charts via
TradingView Lightweight Charts, a scrolling structured-log view, order blotter)
is still TODO -- the engine/risk wiring below is the load-bearing part.
"""

from __future__ import annotations

import threading

from trading.config.settings import Settings, get_settings
from trading.engine.engine import Engine
from trading.risk.risk_layer import RiskLayer

try:
    from PySide6.QtCore import Qt, QTimer
    from PySide6.QtWidgets import (
        QApplication,
        QHBoxLayout,
        QHeaderView,
        QLabel,
        QMainWindow,
        QPushButton,
        QTableWidget,
        QTableWidgetItem,
        QVBoxLayout,
        QWidget,
    )

    _HAS_QT = True
except ImportError:  # pragma: no cover - UI extra not installed
    _HAS_QT = False


if _HAS_QT:

    class TradingWindow(QMainWindow):
        """Monitoring window with a kill switch over a running engine."""

        def __init__(self, engine: Engine, risk: RiskLayer, mode: str) -> None:
            super().__init__()
            self._engine = engine
            self._risk = risk
            self.setWindowTitle(f"Day-Trader — {mode.upper()}")
            self.resize(720, 480)

            root = QWidget()
            layout = QVBoxLayout(root)

            header = QHBoxLayout()
            self._mode_label = QLabel(f"Mode: {mode.upper()}")
            self._equity_label = QLabel("Equity: —")
            header.addWidget(self._mode_label)
            header.addStretch()
            header.addWidget(self._equity_label)
            layout.addLayout(header)

            self._table = QTableWidget(0, 5)
            self._table.setHorizontalHeaderLabels(
                ["Symbol", "Qty", "Avg", "Price", "uPnL"]
            )
            self._table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
            layout.addWidget(self._table)

            self._kill_button = QPushButton("KILL SWITCH — halt & flatten")
            self._kill_button.setStyleSheet(
                "background-color: #c0392b; color: white; font-weight: bold; padding: 12px;"
            )
            self._kill_button.clicked.connect(self._on_kill)
            layout.addWidget(self._kill_button)

            self._status = QLabel("Running")
            layout.addWidget(self._status)

            self.setCentralWidget(root)

            self._timer = QTimer(self)
            self._timer.timeout.connect(self._refresh)
            self._timer.start(1000)

        def _on_kill(self) -> None:
            # Halt all new orders and flatten open positions.
            self._risk.engage_kill_switch(flatten=True)
            self._status.setText("KILL SWITCH ENGAGED — trading halted")
            self._kill_button.setEnabled(False)

        def _refresh(self) -> None:
            account = self._engine.account
            if account is not None:
                self._equity_label.setText(f"Equity: {account.equity:,.2f}")
            positions = list(self._engine.positions.values())
            self._table.setRowCount(len(positions))
            for row, pos in enumerate(positions):
                values = [
                    pos.symbol,
                    str(pos.qty),
                    str(pos.avg_price),
                    str(pos.current_price or "—"),
                    str(pos.unrealized_pnl),
                ]
                for col, value in enumerate(values):
                    item = QTableWidgetItem(value)
                    item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                    self._table.setItem(row, col, item)
            if self._risk.kill_switch_engaged:
                self._status.setText("KILL SWITCH ENGAGED — trading halted")


def main(settings: Settings | None = None) -> int:
    """Launch the desktop UI over a live (paper) engine."""
    if not _HAS_QT:  # pragma: no cover
        raise ImportError("PySide6 is not installed. Install the UI extra: pip install -e '.[ui]'")

    from trading.factory import build_engine
    from trading.strategy.examples.ma_crossover import MaCrossoverStrategy

    settings = settings or get_settings()
    if settings.is_backtest:
        raise SystemExit("UI runs over paper/live, not backtest mode.")

    strategy = MaCrossoverStrategy(settings.symbols)
    engine, db = build_engine(settings, strategy)

    engine_thread = threading.Thread(target=engine.run_live, name="engine", daemon=True)
    engine_thread.start()

    app = QApplication([])
    window = TradingWindow(engine, engine.risk, settings.mode.value)
    window.show()
    try:
        return app.exec()
    finally:
        engine.stop("ui_closed")
        engine_thread.join(timeout=5)
        db.dispose()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
