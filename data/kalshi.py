from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
DEFAULT_CACHE_DB = Path.home() / ".cache" / "stocklens" / "kalshi.sqlite3"

_CACHE_LOCK = threading.Lock()
_INITIALIZED = False


def _connect(db_path: str | os.PathLike[str] | None = None) -> sqlite3.Connection:
    cache_path = Path(db_path or DEFAULT_CACHE_DB)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(cache_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kalshi_cache (
            cache_key TEXT PRIMARY KEY,
            endpoint TEXT NOT NULL,
            params_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kalshi_events (
            event_ticker TEXT PRIMARY KEY,
            series_ticker TEXT,
            title TEXT,
            sub_title TEXT,
            category TEXT,
            status TEXT,
            close_ts TEXT,
            updated_ts TEXT,
            payload_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kalshi_markets (
            market_ticker TEXT PRIMARY KEY,
            event_ticker TEXT,
            series_ticker TEXT,
            title TEXT,
            status TEXT,
            yes_bid REAL,
            yes_ask REAL,
            no_bid REAL,
            no_ask REAL,
            last_price REAL,
            volume_fp REAL,
            open_interest_fp REAL,
            close_ts TEXT,
            updated_ts TEXT,
            payload_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kalshi_series (
            series_ticker TEXT PRIMARY KEY,
            title TEXT,
            category TEXT,
            frequency TEXT,
            volume_fp REAL,
            last_updated_ts TEXT,
            payload_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        )
        """
    )


def _ensure_db() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _CACHE_LOCK:
        if _INITIALIZED:
            return
        conn = _connect()
        try:
            _init_db(conn)
            conn.commit()
        finally:
            conn.close()
        _INITIALIZED = True


def _now_ts() -> int:
    return int(time.time())


def _stable_params(params: dict[str, Any] | None) -> str:
    clean = {}
    for key, value in (params or {}).items():
        if value is None or value == "":
            continue
        clean[key] = value
    return json.dumps(clean, sort_keys=True, separators=(",", ":"), default=str)


def _cache_key(endpoint: str, params: dict[str, Any] | None) -> str:
    return f"{endpoint}?{_stable_params(params)}"


def _ttl_for_endpoint(endpoint: str) -> int:
    if endpoint.endswith("/orderbook"):
        return 15
    if endpoint.endswith("/candlesticks"):
        return 120
    if endpoint.endswith("/markets") or endpoint.endswith("/events"):
        return 120
    if endpoint.endswith("/market") or endpoint.endswith("/event"):
        return 300
    if endpoint.endswith("/series"):
        return 1800
    return 300


def _http_get(endpoint: str, params: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    query = urlencode([(k, v) for k, v in (params or {}).items() if v is not None], doseq=True)
    url = f"{BASE_URL}{endpoint}"
    if query:
        url = f"{url}?{query}"
    req = Request(url, headers={"accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise RuntimeError(f"Kalshi API error {exc.code} for {endpoint}: {body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"Kalshi request failed for {endpoint}: {exc.reason}") from exc


def _get_cached(endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    _ensure_db()
    cache_key = _cache_key(endpoint, params)
    now = _now_ts()
    conn = _connect()
    try:
        _init_db(conn)
        row = conn.execute(
            "SELECT payload_json, expires_at, cached_at FROM kalshi_cache WHERE cache_key = ?",
            [cache_key],
        ).fetchone()
        if row is None or int(row["expires_at"]) <= now:
            return None
        payload = json.loads(row["payload_json"])
        if isinstance(payload, dict):
            payload.setdefault("cache", {})
            payload["cache"].update(
                {
                    "status": "hit",
                    "cached_at": int(row["cached_at"]),
                    "age_seconds": max(0, now - int(row["cached_at"])),
                }
            )
        return payload
    finally:
        conn.close()


def _write_cache(
    endpoint: str,
    params: dict[str, Any] | None,
    payload: dict[str, Any],
    ttl: int | None = None,
) -> dict[str, Any]:
    _ensure_db()
    cache_key = _cache_key(endpoint, params)
    now = _now_ts()
    ttl = int(ttl or _ttl_for_endpoint(endpoint))
    expires_at = now + ttl
    conn = _connect()
    try:
        _init_db(conn)
        conn.execute(
            """
            INSERT OR REPLACE INTO kalshi_cache
            (cache_key, endpoint, params_json, cached_at, expires_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                cache_key,
                endpoint,
                _stable_params(params),
                now,
                expires_at,
                json.dumps(payload, default=str, separators=(",", ":")),
            ],
        )
        conn.commit()
    finally:
        conn.close()
    if isinstance(payload, dict):
        payload = dict(payload)
        payload["cache"] = {
            "status": "refresh",
            "cached_at": now,
            "age_seconds": 0,
            "expires_at": expires_at,
        }
    return payload


def _fetch(
    endpoint: str,
    params: dict[str, Any] | None = None,
    *,
    force_refresh: bool = False,
    ttl: int | None = None,
) -> dict[str, Any]:
    cached = None if force_refresh else _get_cached(endpoint, params)
    if cached is not None:
        return cached
    payload = _http_get(endpoint, params=params)
    return _write_cache(endpoint, params, payload, ttl=ttl)


def _parse_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _upsert_events(events: list[dict[str, Any]]) -> None:
    if not events:
        return
    _ensure_db()
    now = _now_ts()
    conn = _connect()
    try:
        _init_db(conn)
        for event in events:
            event_ticker = event.get("event_ticker")
            if not event_ticker:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO kalshi_events (
                    event_ticker, series_ticker, title, sub_title, category,
                    status, close_ts, updated_ts, payload_json, cached_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    event_ticker,
                    event.get("series_ticker"),
                    event.get("title"),
                    event.get("sub_title"),
                    event.get("category"),
                    event.get("status"),
                    event.get("close_ts"),
                    event.get("updated_ts") or event.get("last_updated_ts"),
                    json.dumps(event, default=str, separators=(",", ":")),
                    now,
                ],
            )
        conn.commit()
    finally:
        conn.close()


def _extract_market_summary(market: dict[str, Any]) -> dict[str, Any]:
    yes = market.get("yes")
    no = market.get("no")
    def _side_value(side: Any, key: str) -> float | None:
        if isinstance(side, dict):
            return _parse_float(side.get(key))
        return None
    return {
        "market_ticker": market.get("ticker") or market.get("market_ticker"),
        "event_ticker": market.get("event_ticker"),
        "series_ticker": market.get("series_ticker"),
        "title": market.get("title"),
        "status": market.get("status"),
        "yes_bid": _side_value(yes, "bid"),
        "yes_ask": _side_value(yes, "ask"),
        "no_bid": _side_value(no, "bid"),
        "no_ask": _side_value(no, "ask"),
        "last_price": _parse_float(market.get("last_price_dollars") or market.get("last_price")),
        "volume_fp": _parse_float(market.get("volume_fp") or market.get("volume")),
        "open_interest_fp": _parse_float(market.get("open_interest_fp") or market.get("open_interest")),
        "close_ts": market.get("close_ts"),
        "updated_ts": market.get("updated_ts") or market.get("last_updated_ts"),
    }


def _upsert_markets(markets: list[dict[str, Any]]) -> None:
    if not markets:
        return
    _ensure_db()
    now = _now_ts()
    conn = _connect()
    try:
        _init_db(conn)
        for market in markets:
            summary = _extract_market_summary(market)
            market_ticker = summary["market_ticker"]
            if not market_ticker:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO kalshi_markets (
                    market_ticker, event_ticker, series_ticker, title, status,
                    yes_bid, yes_ask, no_bid, no_ask, last_price, volume_fp,
                    open_interest_fp, close_ts, updated_ts, payload_json, cached_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    market_ticker,
                    summary["event_ticker"],
                    summary["series_ticker"],
                    summary["title"],
                    summary["status"],
                    summary["yes_bid"],
                    summary["yes_ask"],
                    summary["no_bid"],
                    summary["no_ask"],
                    summary["last_price"],
                    summary["volume_fp"],
                    summary["open_interest_fp"],
                    summary["close_ts"],
                    summary["updated_ts"],
                    json.dumps(market, default=str, separators=(",", ":")),
                    now,
                ],
            )
        conn.commit()
    finally:
        conn.close()


def _upsert_series(series: dict[str, Any]) -> None:
    if not series:
        return
    _ensure_db()
    now = _now_ts()
    conn = _connect()
    try:
        _init_db(conn)
        ticker = series.get("ticker") or series.get("series_ticker")
        if not ticker:
            return
        conn.execute(
            """
            INSERT OR REPLACE INTO kalshi_series (
                series_ticker, title, category, frequency, volume_fp,
                last_updated_ts, payload_json, cached_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ticker,
                series.get("title"),
                series.get("category"),
                series.get("frequency"),
                _parse_float(series.get("volume_fp")),
                series.get("last_updated_ts"),
                json.dumps(series, default=str, separators=(",", ":")),
                now,
            ],
        )
        conn.commit()
    finally:
        conn.close()


def get_events(
    *,
    cursor: str | None = None,
    limit: int | None = None,
    status: str | None = None,
    series_ticker: str | None = None,
    min_close_ts: int | None = None,
    min_updated_ts: int | None = None,
    with_nested_markets: bool = False,
    with_milestones: bool = False,
    force_refresh: bool = False,
) -> dict[str, Any]:
    params = {
        "cursor": cursor,
        "limit": limit,
        "status": status,
        "series_ticker": series_ticker,
        "min_close_ts": min_close_ts,
        "min_updated_ts": min_updated_ts,
        "with_nested_markets": str(bool(with_nested_markets)).lower(),
        "with_milestones": str(bool(with_milestones)).lower(),
    }
    payload = _fetch("/events", params, force_refresh=force_refresh)
    events = payload.get("events") or []
    _upsert_events(events)
    markets = payload.get("markets") or []
    if markets:
        _upsert_markets(markets)
    nested_markets: list[dict[str, Any]] = []
    for event in events:
        if isinstance(event, dict):
            nested_markets.extend(event.get("markets") or [])
    if nested_markets:
        _upsert_markets(nested_markets)
    return payload


def get_event(event_ticker: str, *, with_nested_markets: bool = False, force_refresh: bool = False) -> dict[str, Any]:
    payload = _fetch(
        f"/events/{event_ticker}",
        {"with_nested_markets": str(bool(with_nested_markets)).lower()},
        force_refresh=force_refresh,
    )
    event = payload.get("event") or {}
    if event:
        _upsert_events([event])
        markets = event.get("markets") or []
        if markets:
            _upsert_markets(markets)
    extra_markets = payload.get("markets") or []
    if extra_markets:
        _upsert_markets(extra_markets)
    return payload


def get_markets(
    *,
    cursor: str | None = None,
    limit: int | None = None,
    event_ticker: str | None = None,
    series_ticker: str | None = None,
    max_close_ts: int | None = None,
    min_close_ts: int | None = None,
    status: str | None = None,
    tickers: list[str] | str | None = None,
    min_updated_ts: int | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    tickers_param: str | None
    if isinstance(tickers, str):
        tickers_param = tickers
    elif tickers:
        tickers_param = ",".join(str(item).strip() for item in tickers if str(item).strip())
    else:
        tickers_param = None
    params = {
        "cursor": cursor,
        "limit": limit,
        "event_ticker": event_ticker,
        "series_ticker": series_ticker,
        "max_close_ts": max_close_ts,
        "min_close_ts": min_close_ts,
        "status": status,
        "min_updated_ts": min_updated_ts,
        "tickers": tickers_param,
    }
    payload = _fetch("/markets", params, force_refresh=force_refresh)
    _upsert_markets(payload.get("markets") or [])
    return payload


def get_market(ticker: str, *, force_refresh: bool = False) -> dict[str, Any]:
    payload = _fetch(f"/markets/{ticker}", None, force_refresh=force_refresh)
    market = payload.get("market") or {}
    if market:
        _upsert_markets([market])
    return payload


def get_market_orderbook(ticker: str, depth: int | None = None, *, force_refresh: bool = False) -> dict[str, Any]:
    params = {"depth": depth}
    return _fetch(f"/markets/{ticker}/orderbook", params, force_refresh=force_refresh, ttl=15)


def get_market_candlesticks(
    series_ticker: str,
    ticker: str,
    *,
    start_ts: int,
    end_ts: int,
    period_interval: int = 60,
    include_latest_before_start: bool = False,
    force_refresh: bool = False,
) -> dict[str, Any]:
    params = {
        "start_ts": start_ts,
        "end_ts": end_ts,
        "period_interval": period_interval,
        "include_latest_before_start": str(bool(include_latest_before_start)).lower(),
    }
    return _fetch(
        f"/series/{series_ticker}/markets/{ticker}/candlesticks",
        params,
        force_refresh=force_refresh,
        ttl=120,
    )


def get_series(series_ticker: str, *, force_refresh: bool = False) -> dict[str, Any]:
    payload = _fetch(f"/series/{series_ticker}", None, force_refresh=force_refresh)
    series = payload.get("series") or {}
    if series:
        _upsert_series(series)
    return payload


def cache_stats() -> dict[str, Any]:
    _ensure_db()
    conn = _connect()
    try:
        _init_db(conn)
        cache_rows = conn.execute("SELECT COUNT(*) AS count FROM kalshi_cache").fetchone()
        event_rows = conn.execute("SELECT COUNT(*) AS count FROM kalshi_events").fetchone()
        market_rows = conn.execute("SELECT COUNT(*) AS count FROM kalshi_markets").fetchone()
        series_rows = conn.execute("SELECT COUNT(*) AS count FROM kalshi_series").fetchone()
        return {
            "cache_entries": int(cache_rows["count"]),
            "events": int(event_rows["count"]),
            "markets": int(market_rows["count"]),
            "series": int(series_rows["count"]),
            "cache_db": str(DEFAULT_CACHE_DB),
        }
    finally:
        conn.close()
