"""Structured logging configuration (BUILD_PLAN §6.6).

Logs are emitted as JSON to ``logs/trading.log`` and human-readable to the
console. The DB remains the source of truth for trading actions (signals,
orders, fills, risk decisions); these logs are the operational/diagnostic trail.
"""

from __future__ import annotations

import logging
import logging.handlers
import sys
from pathlib import Path

import structlog

_CONFIGURED = False


def configure_logging(
    level: str = "INFO",
    log_dir: str | Path = "logs",
    *,
    json_logs: bool = True,
    to_file: bool = True,
) -> None:
    """Configure stdlib + structlog. Idempotent; safe to call more than once."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    numeric_level = getattr(logging, level.upper(), logging.INFO)

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    # structlog feeds the stdlib logging machinery so third-party libs that use
    # stdlib logging land in the same handlers/format.
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    console_renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer()
        if json_logs
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )
    file_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processor=structlog.processors.JSONRenderer(),
    )
    console_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processor=console_renderer,
    )

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(numeric_level)

    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(console_formatter)
    root.addHandler(console_handler)

    if to_file:
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_path / "trading.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(file_formatter)
        root.addHandler(file_handler)

    _CONFIGURED = True


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger. Configures with defaults if needed."""
    if not _CONFIGURED:
        configure_logging()
    return structlog.stdlib.get_logger(name)
