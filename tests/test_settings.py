"""Settings / live-gating tests (BUILD_PLAN §2, §6.1, §8)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from trading.config.settings import LIVE_BASE_URL, PAPER_BASE_URL, Mode, Settings


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> Settings:
    # Start from a clean slate so the host environment can't leak in.
    for key in list(env):
        monkeypatch.setenv(key, env[key])
    return Settings(_env_file=None)


def test_default_mode_is_paper(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TRADING_MODE", raising=False)
    s = Settings(_env_file=None)
    assert s.mode is Mode.PAPER
    assert s.is_paper


def test_live_mode_refused_without_interlock(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(Exception) as exc:
        _settings(monkeypatch, TRADING_MODE="live", ALLOW_LIVE_TRADING="0")
    assert "ALLOW_LIVE_TRADING" in str(exc.value)


def test_live_mode_allowed_with_interlock(monkeypatch: pytest.MonkeyPatch) -> None:
    s = _settings(monkeypatch, TRADING_MODE="live", ALLOW_LIVE_TRADING="1")
    assert s.is_live
    assert s.resolved_base_url == LIVE_BASE_URL
    assert s.alpaca_paper is False


def test_paper_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    s = _settings(monkeypatch, TRADING_MODE="paper")
    assert s.resolved_base_url == PAPER_BASE_URL
    assert s.alpaca_paper is True


def test_symbols_parsed_from_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    s = _settings(monkeypatch, TRADING_SYMBOLS="aapl, msft ,tsla")
    assert s.symbols == ["AAPL", "MSFT", "TSLA"]


def test_risk_limits_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    s = _settings(monkeypatch, RISK_MAX_ORDER_NOTIONAL="500", RISK_MAX_ORDERS_PER_MINUTE="7")
    assert s.risk.max_order_notional == Decimal("500")
    assert s.risk.max_orders_per_minute == 7


def test_require_alpaca_credentials_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    s = Settings(_env_file=None)
    with pytest.raises(ValueError):
        s.require_alpaca_credentials()
