"""PySide6 desktop monitor + kill switch (BUILD_PLAN §6.10, Phase 5).

A native Qt monitoring window over a running (paper/live) engine:

* mode indicator + equity / cash / buying-power / daily-P&L header
* live **equity-curve** chart (QtCharts)
* live **positions / P&L** table
* a **fills blotter** (recent executions)
* a scrolling **structured-log** view (captures the app's structlog output)
* a prominent **kill switch** wired to ``RiskLayer.engage_kill_switch(flatten=True)``

The engine runs on a background thread; a 1s timer polls engine/risk state and
refreshes the widgets on the GUI thread. Log records are marshalled to the GUI
thread via a Qt signal so cross-thread logging is safe.

PySide6 is an *optional* dependency (``pip install -e '.[ui]'``); this module
imports without it (so the rest of the app/tests are unaffected). It is a desktop
app and needs a display -- it does not run in a headless/cloud session.

Note on charts: the build plan suggests TradingView Lightweight Charts. Those
require an embedded Chromium web view (QtWebEngine); this scaffold uses native
QtCharts instead to stay dependency-light. The chart widget is isolated in
``_EquityChart`` so it can be swapped for a web view later without touching the
rest of the window.
"""

from __future__ import annotations

import logging
import threading
from decimal import Decimal

from trading.config.settings import Settings, get_settings
from trading.core.models import Fill, Position
from trading.engine.engine import Engine
from trading.risk.risk_layer import RiskLayer

try:
    import structlog
    from PySide6.QtCharts import QChart, QChartView, QDateTimeAxis, QLineSeries, QValueAxis
    from PySide6.QtCore import QDateTime, QObject, Qt, QTimer, Signal
    from PySide6.QtGui import QColor, QPainter
    from PySide6.QtWidgets import (
        QApplication,
        QGroupBox,
        QHBoxLayout,
        QHeaderView,
        QLabel,
        QMainWindow,
        QPlainTextEdit,
        QPushButton,
        QSplitter,
        QTableWidget,
        QTableWidgetItem,
        QVBoxLayout,
        QWidget,
    )

    _HAS_QT = True
except ImportError:  # pragma: no cover - UI extra not installed
    _HAS_QT = False


if _HAS_QT:

    class _LogEmitter(QObject):
        """Bridges background-thread log records onto the GUI thread."""

        message = Signal(str)

    class QtLogHandler(logging.Handler):
        """A logging handler that forwards formatted records to the log view."""

        def __init__(self, emitter: _LogEmitter) -> None:
            super().__init__()
            self._emitter = emitter
            self.setFormatter(
                structlog.stdlib.ProcessorFormatter(
                    processor=structlog.dev.ConsoleRenderer(colors=False),
                )
            )

        def emit(self, record: logging.LogRecord) -> None:
            try:
                self._emitter.message.emit(self.format(record))
            except Exception:  # pragma: no cover - never let logging crash the app
                self.handleError(record)

    class _EquityChart(QWidget):
        """Encapsulated equity-curve chart (QtCharts)."""

        def __init__(self) -> None:
            super().__init__()
            self._series = QLineSeries()
            chart = QChart()
            chart.addSeries(self._series)
            chart.legend().hide()
            chart.setTitle("Equity")
            self._axis_x = QDateTimeAxis()
            self._axis_x.setFormat("HH:mm:ss")
            self._axis_x.setTitleText("Time")
            self._axis_y = QValueAxis()
            self._axis_y.setTitleText("$")
            chart.addAxis(self._axis_x, Qt.AlignmentFlag.AlignBottom)
            chart.addAxis(self._axis_y, Qt.AlignmentFlag.AlignLeft)
            self._series.attachAxis(self._axis_x)
            self._series.attachAxis(self._axis_y)

            view = QChartView(chart)
            view.setRenderHint(QPainter.RenderHint.Antialiasing)
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.addWidget(view)

        def update_points(self, history: list[tuple[object, object]]) -> None:
            if not history:
                return
            points = history[-1000:]
            self._series.clear()
            ys: list[float] = []
            first_ms = last_ms = 0.0
            for i, (ts, equity) in enumerate(points):
                ms = float(ts.timestamp() * 1000)  # type: ignore[attr-defined]
                y = float(equity)  # type: ignore[arg-type]
                ys.append(y)
                self._series.append(ms, y)
                if i == 0:
                    first_ms = ms
                last_ms = ms
            self._axis_x.setRange(
                QDateTime.fromMSecsSinceEpoch(int(first_ms)),
                QDateTime.fromMSecsSinceEpoch(int(last_ms)),
            )
            lo, hi = min(ys), max(ys)
            pad = (hi - lo) * 0.05 or max(abs(hi) * 0.01, 1.0)
            self._axis_y.setRange(lo - pad, hi + pad)

    class TradingWindow(QMainWindow):
        """Monitoring window with a kill switch over a running engine."""

        def __init__(
            self, engine: Engine, risk: RiskLayer, mode: str, emitter: _LogEmitter
        ) -> None:
            super().__init__()
            self._engine = engine
            self._risk = risk
            self.setWindowTitle(f"Day-Trader — {mode.upper()}")
            self.resize(1100, 780)

            root = QWidget()
            outer = QVBoxLayout(root)

            outer.addLayout(self._build_header(mode))

            self._chart = _EquityChart()
            self._positions = self._make_table(["Symbol", "Qty", "Avg", "Price", "uPnL"])
            self._blotter = self._make_table(["Time", "Symbol", "Side", "Qty", "Price"])
            self._log = QPlainTextEdit()
            self._log.setReadOnly(True)
            self._log.setMaximumBlockCount(2000)
            emitter.message.connect(self._log.appendPlainText)

            outer.addWidget(self._splitter(), stretch=1)

            # "&&" escapes Qt's mnemonic so the ampersand renders literally.
            self._kill_button = QPushButton("◼  KILL SWITCH — halt && flatten")
            self._kill_button.setStyleSheet(
                "background-color:#c0392b;color:white;font-weight:bold;padding:14px;font-size:15px;"
            )
            self._kill_button.clicked.connect(self._on_kill)
            outer.addWidget(self._kill_button)

            self._status = QLabel("● Running")
            outer.addWidget(self._status)

            self.setCentralWidget(root)

            self._timer = QTimer(self)
            self._timer.timeout.connect(self._refresh)
            self._timer.start(1000)

        # -- construction helpers -----------------------------------------
        def _build_header(self, mode: str) -> QHBoxLayout:
            header = QHBoxLayout()
            self._mode_label = QLabel(f"Mode: {mode.upper()}")
            self._mode_label.setStyleSheet("font-weight:bold;")
            self._equity_label = QLabel("Equity: —")
            self._cash_label = QLabel("Cash: —")
            self._bp_label = QLabel("Buying power: —")
            self._pnl_label = QLabel("Daily P&L: —")
            header.addWidget(self._mode_label)
            header.addStretch()
            for widget in (self._equity_label, self._cash_label, self._bp_label, self._pnl_label):
                header.addWidget(widget)
            return header

        @staticmethod
        def _make_table(headers: list[str]) -> QTableWidget:
            table = QTableWidget(0, len(headers))
            table.setHorizontalHeaderLabels(headers)
            table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
            table.verticalHeader().setVisible(False)
            table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
            return table

        def _splitter(self) -> QSplitter:
            tables = QSplitter(Qt.Orientation.Horizontal)
            tables.addWidget(self._group("Positions", self._positions))
            tables.addWidget(self._group("Fills", self._blotter))

            splitter = QSplitter(Qt.Orientation.Vertical)
            splitter.addWidget(self._group("Equity curve", self._chart))
            splitter.addWidget(tables)
            splitter.addWidget(self._group("Log", self._log))
            splitter.setSizes([320, 240, 220])
            return splitter

        @staticmethod
        def _group(title: str, widget: QWidget) -> QGroupBox:
            box = QGroupBox(title)
            layout = QVBoxLayout(box)
            layout.addWidget(widget)
            return box

        # -- actions -------------------------------------------------------
        def _on_kill(self) -> None:
            self._risk.engage_kill_switch(flatten=True)
            self._status.setText("● KILL SWITCH ENGAGED — trading halted")
            self._kill_button.setEnabled(False)

        # -- refresh -------------------------------------------------------
        def _refresh(self) -> None:
            acct = self._engine.account
            if acct is not None:
                self._equity_label.setText(f"Equity: ${acct.equity:,.2f}")
                self._cash_label.setText(f"Cash: ${acct.cash:,.2f}")
                self._bp_label.setText(f"Buying power: ${acct.buying_power:,.2f}")
                base = acct.last_equity or acct.equity
                self._pnl_label.setText(f"Daily P&L: ${acct.equity - base:,.2f}")
            self._fill_positions(list(self._engine.positions.values()))
            self._fill_blotter(self._engine.recent_fills)
            self._chart.update_points(self._engine.equity_history)  # type: ignore[arg-type]
            self._update_status()

        def _update_status(self) -> None:
            if self._risk.kill_switch_engaged:
                self._status.setText("● KILL SWITCH ENGAGED — trading halted")
            elif self._engine.paused:
                self._status.setText("● PAUSED (disconnected) — new entries suppressed")
            elif self._risk.halted:
                self._status.setText("● DAILY-LOSS HALT — exits only")
            else:
                self._status.setText("● Running")

        def _fill_positions(self, positions: list[Position]) -> None:
            self._positions.setRowCount(len(positions))
            for row, pos in enumerate(positions):
                cells = [
                    pos.symbol,
                    f"{pos.qty}",
                    f"{pos.avg_price}",
                    f"{pos.current_price if pos.current_price is not None else '—'}",
                    f"{pos.unrealized_pnl:,.2f}",
                ]
                self._set_row(self._positions, row, cells)
                item = self._positions.item(row, 4)
                color = self._pnl_color(pos.unrealized_pnl)
                if item is not None and color is not None:
                    item.setForeground(color)

        def _fill_blotter(self, fills: list[Fill]) -> None:
            recent = list(reversed(fills))[:100]
            self._blotter.setRowCount(len(recent))
            for row, fill in enumerate(recent):
                cells = [
                    fill.ts.strftime("%H:%M:%S"),
                    fill.symbol,
                    fill.side.value.upper(),
                    f"{fill.qty}",
                    f"{fill.price}",
                ]
                self._set_row(self._blotter, row, cells)

        @staticmethod
        def _set_row(table: QTableWidget, row: int, cells: list[str]) -> None:
            for col, value in enumerate(cells):
                item = QTableWidgetItem(value)
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
                table.setItem(row, col, item)

        @staticmethod
        def _pnl_color(pnl: Decimal) -> QColor | None:
            if pnl > 0:
                return QColor("#27ae60")
            if pnl < 0:
                return QColor("#c0392b")
            return None


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

    app = QApplication([])
    emitter = _LogEmitter()
    # Build the window (and connect the log signal) BEFORE the engine starts, so
    # no early log lines are missed.
    window = TradingWindow(engine, engine.risk, settings.mode.value, emitter)
    logging.getLogger().addHandler(QtLogHandler(emitter))  # mirror logs into the view

    engine_thread = threading.Thread(target=engine.run_live, name="engine", daemon=True)
    engine_thread.start()
    window.show()
    try:
        return app.exec()
    finally:
        engine.stop("ui_closed")
        engine_thread.join(timeout=5)
        db.dispose()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
