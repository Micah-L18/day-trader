"""Application settings, loaded from environment / ``.env`` (BUILD_PLAN §6.1).

Guardrail enforced here: if ``mode == live`` but ``ALLOW_LIVE_TRADING`` is not
truthy, construction raises. There is no way to reach a live account without
*both* signals, so an accidental ``TRADING_MODE=live`` can never route real
orders on its own.
"""

from __future__ import annotations

from decimal import Decimal
from enum import Enum
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

__all__ = ["DataFeed", "Mode", "RiskLimits", "Settings", "get_settings"]

PAPER_BASE_URL = "https://paper-api.alpaca.markets"
LIVE_BASE_URL = "https://api.alpaca.markets"


class Mode(str, Enum):
    BACKTEST = "backtest"
    PAPER = "paper"
    LIVE = "live"


class DataFeed(str, Enum):
    IEX = "iex"  # free
    SIP = "sip"  # paid, full consolidated tape


class RiskLimits(BaseSettings):
    """Configurable limits enforced by the risk layer (BUILD_PLAN §6.5).

    Read from ``RISK_*`` environment variables. Every field has a conservative
    default so the system is safe even with no risk config provided.
    """

    model_config = SettingsConfigDict(
        env_prefix="RISK_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Per-symbol caps.
    max_position_shares: Decimal = Decimal("1000")
    max_position_notional: Decimal = Decimal("25000")
    # Aggregate cap across all positions (absolute market value).
    max_gross_exposure: Decimal = Decimal("100000")
    # Hard ceiling on any single order's notional -- catches fat-finger/runaway.
    max_order_notional: Decimal = Decimal("25000")
    # Daily realised+unrealised loss that trips the new-entry halt (positive #).
    daily_loss_limit: Decimal = Decimal("2000")
    # Throttle to catch runaway loops.
    max_orders_per_minute: int = 30
    # Default protective-stop distance below entry (fraction) when a signal does
    # not specify its own stop. 0 disables the auto-stop (NOT recommended).
    stop_loss_pct: Decimal = Decimal("0.02")

    @field_validator(
        "max_position_shares",
        "max_position_notional",
        "max_gross_exposure",
        "max_order_notional",
        "daily_loss_limit",
        "stop_loss_pct",
    )
    @classmethod
    def _non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("risk limits must be non-negative")
        return v


class Settings(BaseSettings):
    """Top-level application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- mode & live gate -------------------------------------------------
    mode: Mode = Field(default=Mode.PAPER, validation_alias="TRADING_MODE")
    allow_live_trading: bool = Field(default=False, validation_alias="ALLOW_LIVE_TRADING")

    # --- Alpaca -----------------------------------------------------------
    alpaca_api_key: str | None = Field(default=None, validation_alias="ALPACA_API_KEY")
    alpaca_secret_key: str | None = Field(default=None, validation_alias="ALPACA_SECRET_KEY")
    alpaca_base_url: str | None = Field(default=None, validation_alias="ALPACA_BASE_URL")
    alpaca_data_feed: DataFeed = Field(default=DataFeed.IEX, validation_alias="ALPACA_DATA_FEED")

    # --- universe & strategy ---------------------------------------------
    symbols: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["AAPL", "MSFT"], validation_alias="TRADING_SYMBOLS"
    )
    timeframe: str = Field(default="1Min", validation_alias="TRADING_TIMEFRAME")

    # --- persistence & logging -------------------------------------------
    db_path: str = Field(default="trading.db", validation_alias="DB_PATH")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_dir: str = Field(default="logs", validation_alias="LOG_DIR")
    log_json: bool = Field(default=True, validation_alias="LOG_JSON")

    # --- risk -------------------------------------------------------------
    risk: RiskLimits = Field(default_factory=RiskLimits)

    @field_validator("symbols", mode="before")
    @classmethod
    def _split_symbols(cls, v: object) -> object:
        """Accept a comma-separated env string or an already-parsed list."""
        if isinstance(v, str):
            return [s.strip().upper() for s in v.split(",") if s.strip()]
        return v

    @model_validator(mode="after")
    def _enforce_live_gate(self) -> Settings:
        if self.mode is Mode.LIVE and not self.allow_live_trading:
            raise ValueError(
                "Refusing to start in LIVE mode: ALLOW_LIVE_TRADING is not set. "
                "Live trading requires BOTH mode=live AND ALLOW_LIVE_TRADING=1 "
                "(BUILD_PLAN guardrail §2)."
            )
        return self

    # --- convenience ------------------------------------------------------
    @property
    def is_live(self) -> bool:
        return self.mode is Mode.LIVE

    @property
    def is_paper(self) -> bool:
        return self.mode is Mode.PAPER

    @property
    def is_backtest(self) -> bool:
        return self.mode is Mode.BACKTEST

    @property
    def alpaca_paper(self) -> bool:
        """Alpaca trades against the paper endpoint unless we are truly live."""
        return self.mode is not Mode.LIVE

    @property
    def resolved_base_url(self) -> str:
        """The Alpaca REST base URL implied by the mode (unless overridden)."""
        if self.alpaca_base_url:
            return self.alpaca_base_url
        return LIVE_BASE_URL if self.is_live else PAPER_BASE_URL

    def require_alpaca_credentials(self) -> tuple[str, str]:
        """Return ``(key, secret)`` or raise a clear error if missing."""
        if not self.alpaca_api_key or not self.alpaca_secret_key:
            raise ValueError(
                "Alpaca credentials are not configured. Set ALPACA_API_KEY and "
                "ALPACA_SECRET_KEY in your environment or .env file."
            )
        return self.alpaca_api_key, self.alpaca_secret_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide cached :class:`Settings` instance."""
    return Settings()
