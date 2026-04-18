from __future__ import annotations

import argparse
import copy
import datetime as dt
import io
import json
import math
import mimetypes
import os
import time
from dataclasses import asdict, is_dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo

import polars as pl
import pandas as pd

from secrs.dcf import batch_dcf, dcf
from secrs.modules.margins import _calculate_margin_table
from secrs.modules.ratios import _calculate_ratio_table
from secrs.periphery.revenues import get_revenue_by_region
from secrs.screener import _METRIC_GROUP, screen_tickers
from secrs.ticker import Ticker, Tickers
from secrs.utils.stale import _get_us_market_holidays


STATIC_DIR = Path(__file__).parent / "static"
PAGE_ROUTES = {
    "/",
    "/chat",
    "/dashboard",
    "/markets",
    "/multi",
    "/watchlist",
    "/screener",
    "/dcf",
}


def _web_search(query: str, max_results: int = 5) -> list:
    from ddgs import DDGS

    with DDGS() as ddgs:
        return [
            {
                "title": r.get("title", ""),
                "snippet": r.get("body", ""),
                "url": r.get("href", ""),
            }
            for r in ddgs.text(query, max_results=max_results)
        ]


def _call_llm_sync(
    messages: list,
    model: str,
    provider: str,
    api_key: str,
    system: str = None,
    llama_url: str = "http://localhost:8080",
) -> str:
    import requests as _req

    if provider == "claude":
        body = {"model": model, "max_tokens": 1024, "messages": messages}
        if system:
            body["system"] = system
        resp = _req.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]
    elif provider == "llama":
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        msgs = _llama_fold_system(msgs)
        url = f"{llama_url.rstrip('/')}/v1/chat/completions"
        resp = _req.post(
            url,
            headers={"content-type": "application/json"},
            json={"model": "local", "messages": msgs},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    else:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        resp = _req.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            },
            json={"model": model, "max_tokens": 1024, "messages": msgs},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _llama_fold_system(messages: list) -> list:
    """Fold a leading system message into the first user message for llama compat."""
    if not messages or messages[0].get("role") != "system":
        return messages
    sys_content = messages[0]["content"]
    rest = list(messages[1:])
    if rest and rest[0].get("role") == "user":
        rest[0] = {"role": "user", "content": f"{sys_content}\n\n{rest[0]['content']}"}
    else:
        rest = [{"role": "user", "content": sys_content}] + rest
    return rest


def _get_llama_ctx_size(base_url: str, fallback: int = 2048) -> int:
    """Query llama.cpp /props for n_ctx; return fallback on any failure."""
    import requests as _req

    try:
        resp = _req.get(f"{base_url.rstrip('/')}/props", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        n_ctx = data.get("n_ctx") or data.get("total_slots", [{}])[0].get("n_ctx")
        if n_ctx and int(n_ctx) > 0:
            return int(n_ctx)
    except Exception:
        pass
    return fallback


def _trim_search_context(ctx_parts: list[str], max_chars: int) -> str:
    """Join ctx_parts, truncating search snippets to stay within max_chars."""
    full = "".join(ctx_parts)
    if len(full) <= max_chars:
        return full
    result = []
    remaining = max_chars
    for part in ctx_parts:
        if remaining <= 0:
            break
        chunk = part[:remaining]
        result.append(chunk)
        remaining -= len(chunk)
    return "".join(result)


def _stream_llama(payload: dict, base_url: str):
    import requests as _req

    model = payload.get("model", "local")
    messages = _llama_fold_system(payload.get("messages", []))
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    resp = _req.post(
        url,
        headers={"content-type": "application/json"},
        json={"model": model, "messages": messages, "stream": True},
        stream=True,
        timeout=120,
    )
    try:
        resp.raise_for_status()
    except _req.HTTPError as exc:
        try:
            detail = resp.json().get("error", str(exc))
        except Exception:
            detail = str(exc)
        yield f"data: {json.dumps({'error': str(detail)})}\n\n"
        return
    resp.encoding = "utf-8"
    for raw_line in resp.iter_lines(decode_unicode=True):
        if raw_line.startswith("data:"):
            yield raw_line + "\n\n"


def _deep_research_stream(payload: dict):
    provider = payload.get("provider", "claude")
    model = payload.get("model", "claude-sonnet-4-6")
    messages = payload.get("messages", [])
    llama_url = payload.get("llamaUrl", "http://localhost:8080")

    api_key = ""
    if provider == "claude":
        api_key = os.environ.get("SECRS_CLAUDE_API_KEY", "")
        if not api_key:
            yield f"data: {json.dumps({'type': 'error', 'text': 'SECRS_CLAUDE_API_KEY not set'})}\n\n"
            yield "data: [DONE]\n\n"
            return
    elif provider == "openai":
        api_key = os.environ.get("SECRS_OPENAI_API_KEY", "")
        if not api_key:
            yield f"data: {json.dumps({'type': 'error', 'text': 'SECRS_OPENAI_API_KEY not set'})}\n\n"
            yield "data: [DONE]\n\n"
            return

    today = dt.datetime.now().strftime("%B %d, %Y")
    conv_messages = [m for m in messages if m.get("role") in ("user", "assistant")]
    user_question = next(
        (m["content"] for m in reversed(conv_messages) if m["role"] == "user"), ""
    )

    # ── Phase 1: Planning ─────────────────────────────────────────
    yield f"data: {json.dumps({'type': 'status', 'text': 'Planning research...'})}\n\n"

    planning_system = (
        "You are a research planner. Today's date is " + today + ".\n"
        "Analyze the user's question and produce a focused research plan.\n"
        "Respond ONLY with raw JSON (no markdown fences) in this exact format:\n"
        '{"needs_clarification": false, "clarification": null, "queries": ["q1","q2","q3"], "plan": "one-line description"}\n'
        "Generate 3-5 specific web search queries. "
        "Only set needs_clarification=true if the question is fundamentally ambiguous."
    )
    try:
        raw = _call_llm_sync(
            conv_messages, model, provider, api_key, planning_system, llama_url
        )
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        plan = json.loads(raw.strip())
    except Exception:
        plan = {
            "needs_clarification": False,
            "queries": [user_question[:120]],
            "plan": "Direct search",
        }

    if plan.get("needs_clarification") and plan.get("clarification"):
        yield f"data: {json.dumps({'type': 'clarification', 'text': plan['clarification']})}\n\n"
        yield "data: [DONE]\n\n"
        return

    queries = [str(q) for q in plan.get("queries", [user_question])][:5]
    yield f"data: {json.dumps({'type': 'plan', 'queries': queries, 'description': plan.get('plan', '')})}\n\n"

    # ── Phase 2: Search ───────────────────────────────────────────
    all_results = []
    search_ok = True
    for i, query in enumerate(queries):
        yield f"data: {json.dumps({'type': 'searching', 'query': query, 'index': i + 1, 'total': len(queries)})}\n\n"
        if search_ok:
            try:
                results = _web_search(query, max_results=5)
                all_results.append({"query": query, "results": results})
                yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': len(results)})}\n\n"
            except Exception:
                search_ok = False
                all_results.append({"query": query, "results": []})
                yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': 0})}\n\n"
        else:
            all_results.append({"query": query, "results": []})
            yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': 0})}\n\n"

    # ── Phase 3: Synthesize ───────────────────────────────────────
    yield f"data: {json.dumps({'type': 'synthesizing'})}\n\n"

    ctx_parts = [f"[Today's date: {today}]\n"]
    for item in all_results:
        if item["results"]:
            ctx_parts.append(f'\n[Search results for: "{item["query"]}"]\n')
            for j, r in enumerate(item["results"]):
                ctx_parts.append(
                    f'{j + 1}. {r["title"]}\n   {r["snippet"]}\n   {r["url"]}\n'
                )

    if provider == "llama":
        n_ctx = _get_llama_ctx_size(llama_url)
        # Reserve 40% for response; subtract ~300 tokens overhead for system + question
        max_ctx_tokens = int(n_ctx * 0.6) - 300
        max_search_chars = max(500, max_ctx_tokens * 4)
        context = _trim_search_context(ctx_parts, max_search_chars)
    else:
        context = "".join(ctx_parts)

    has_results = any(item["results"] for item in all_results)
    if has_results:
        enriched = (
            f"{context}\n\n---\n\n"
            f"Based on the above research, provide a comprehensive answer to: {user_question}"
        )
    else:
        enriched = user_question

    synth_messages = conv_messages[:-1] + [{"role": "user", "content": enriched}]
    synthesis_system = (
        "You are a research analyst. Synthesize web search results into a comprehensive, well-structured answer. "
        "Cite sources where relevant. Be thorough and accurate. "
        f"Today's date is {today}."
    )
    synth_payload = {
        "model": model,
        "messages": [{"role": "system", "content": synthesis_system}] + synth_messages,
    }
    if provider == "claude":
        stream_gen = _stream_claude(synth_payload)
    elif provider == "llama":
        synth_payload["model"] = "local"
        stream_gen = _stream_llama(synth_payload, llama_url)
    else:
        stream_gen = _stream_openai(synth_payload)

    try:
        for chunk in stream_gen:
            stripped = chunk.strip()
            if stripped in ("data: [DONE]", "data:[DONE]"):
                break
            if stripped.startswith("data:"):
                raw = stripped[5:].lstrip(" \t")
                try:
                    obj = json.loads(raw)
                    token = (obj.get("choices") or [{}])[0].get("delta", {}).get(
                        "content"
                    ) or ""
                    if token:
                        yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                    elif "error" in obj:
                        yield f"data: {json.dumps({'type': 'error', 'text': str(obj['error'])})}\n\n"
                except (json.JSONDecodeError, IndexError, KeyError):
                    pass
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'text': f'Synthesis failed: {exc}'})}\n\n"

    yield "data: [DONE]\n\n"


def _chat_providers() -> dict:
    return {
        "claude": bool(os.environ.get("SECRS_CLAUDE_API_KEY")),
        "openai": bool(os.environ.get("SECRS_OPENAI_API_KEY")),
    }


def _stream_claude(payload: dict):
    import requests as _req

    api_key = os.environ.get("SECRS_CLAUDE_API_KEY", "")
    model = payload.get("model", "claude-sonnet-4-6")
    messages = payload.get("messages", [])
    system_text = None
    if messages and messages[0].get("role") == "system":
        system_text = messages[0]["content"]
        messages = messages[1:]
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {"model": model, "max_tokens": 4096, "messages": messages, "stream": True}
    if system_text:
        body["system"] = system_text
    resp = _req.post(
        "https://api.anthropic.com/v1/messages",
        headers=headers,
        json=body,
        stream=True,
        timeout=60,
    )
    try:
        resp.raise_for_status()
    except _req.HTTPError as exc:
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        return
    event_type = None
    for raw_line in resp.iter_lines(decode_unicode=True):
        if raw_line.startswith("event:"):
            event_type = raw_line[6:].strip()
        elif raw_line.startswith("data:"):
            data_str = raw_line[5:].strip()
            if event_type == "content_block_delta":
                try:
                    obj = json.loads(data_str)
                    text = obj.get("delta", {}).get("text", "")
                    if text:
                        chunk = json.dumps({"choices": [{"delta": {"content": text}}]})
                        yield f"data: {chunk}\n\n"
                except (json.JSONDecodeError, KeyError):
                    pass
            elif event_type == "message_stop":
                yield "data: [DONE]\n\n"
                return


def _stream_openai(payload: dict):
    import requests as _req

    api_key = os.environ.get("SECRS_OPENAI_API_KEY", "")
    model = payload.get("model", "gpt-4o")
    messages = payload.get("messages", [])
    headers = {
        "authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }
    body = {"model": model, "messages": messages, "stream": True}
    resp = _req.post(
        "https://api.openai.com/v1/chat/completions",
        headers=headers,
        json=body,
        stream=True,
        timeout=60,
    )
    try:
        resp.raise_for_status()
    except _req.HTTPError as exc:
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        return
    for raw_line in resp.iter_lines(decode_unicode=True):
        if raw_line.startswith("data:"):
            yield raw_line + "\n\n"


def _search(q: str) -> list[dict]:
    from secrs.data.db import init_tables, insert_data
    import requests
    from secrs.utils.static import HEADERS

    q = q.strip().upper()
    if not q:
        return []

    conn = init_tables()
    count = conn.execute("SELECT COUNT(*) FROM tickers").fetchone()[0]
    if count == 0:
        resp = requests.get(
            "https://www.sec.gov/files/company_tickers.json",
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        import polars as _pl

        rows = list(resp.json().values())
        df = _pl.DataFrame(rows)[["ticker", "title", "cik_str"]].rename(
            {"title": "name", "cik_str": "cik"}
        )
        insert_data(
            df,
            db_cols=["ticker", "name", "cik"],
            table_name="tickers",
            conn=conn,
            pk_cols=["ticker", "cik"],
        )

    results = conn.execute(
        """
        SELECT ticker, name FROM (
            SELECT ticker, name, 0 AS priority FROM tickers WHERE upper(ticker) LIKE ?
            UNION ALL
            SELECT ticker, name, 1 AS priority FROM tickers
             WHERE upper(ticker) NOT LIKE ? AND upper(name) LIKE ?
        )
        GROUP BY ticker
        ORDER BY priority, length(ticker), ticker
        LIMIT 12
        """,
        [f"{q}%", f"{q}%", f"%{q}%"],
    ).fetchall()
    return [{"ticker": r[0], "name": r[1]} for r in results]


def _tickers(value) -> list[str]:
    if isinstance(value, str):
        raw = value.replace("\n", ",").split(",")
    else:
        raw = value or []
    return [str(ticker).strip().upper() for ticker in raw if str(ticker).strip()]


def _jsonable(value):
    if isinstance(value, pl.DataFrame):
        return {
            "columns": value.columns,
            "rows": value.to_dicts(),
            "height": value.height,
            "width": value.width,
        }
    if isinstance(value, pd.DataFrame):
        frame = value.replace([float("inf"), float("-inf")], None)
        frame = frame.where(pd.notnull(frame), None)
        return {
            "columns": list(frame.columns),
            "rows": frame.to_dict(orient="records"),
            "height": len(frame),
            "width": len(frame.columns),
        }
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _single(payload: dict) -> dict:
    ticker = _tickers(payload.get("ticker"))[:1]
    if not ticker:
        raise ValueError("Enter a ticker.")
    ticker_symbol = ticker[0]
    view = payload.get("view", "income_statement")
    quarterly = bool(payload.get("quarterly", False))
    pivot = bool(payload.get("pivot", True))

    if view == "income_statement":
        df = Tickers().get_income_statements(
            [ticker_symbol], quarterly=quarterly, pivot=pivot
        )
    elif view == "balance_sheet":
        df = Tickers().get_balance_sheets(
            [ticker_symbol], quarterly=quarterly, pivot=pivot
        )
    elif view == "cash_flow":
        df = Tickers().get_cash_flows([ticker_symbol], quarterly=quarterly, pivot=pivot)
    elif view == "regions":
        df = get_revenue_by_region(ticker_symbol, quarterly=quarterly)
    else:
        raise ValueError(f"Unsupported single ticker view: {view}")

    return {
        "title": f"{ticker_symbol} {view.replace('_', ' ').title()}",
        "data": _jsonable(df),
    }


def _multi(payload: dict) -> dict:
    tickers = _tickers(payload.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker.")
    analysis = payload.get("analysis", "ratios")
    quarterly = bool(payload.get("quarterly", False))

    rows = []
    for ticker in tickers:
        obj = Ticker(ticker, quarterly=quarterly)
        if analysis == "ratios":
            frame = _calculate_ratio_table(
                ticker,
                quarterly=quarterly,
                income_statement=obj.income_statement,
                balance_sheet=obj.balance_sheet,
                cash_flow=obj.cash_flow,
                pivot=False,
            )
            label_col = "ratio_label"
        elif analysis == "margins":
            frame = _calculate_margin_table(
                ticker,
                quarterly=quarterly,
                income_statement=obj.income_statement,
                balance_sheet=obj.balance_sheet,
                cash_flow=obj.cash_flow,
                pivot=False,
            )
            label_col = "margin_label"
        else:
            raise ValueError(f"Unsupported multi ticker analysis: {analysis}")

        rows.append(_latest_metric_row(ticker, frame, label_col))

    df = pl.DataFrame(rows, infer_schema_length=None)
    metric_columns = sorted([column for column in df.columns if column != "ticker"])
    return {
        "title": f"Latest {analysis.title()}",
        "data": _jsonable(df.select(["ticker", *metric_columns])),
    }


def _latest_metric_row(ticker: str, frame: pl.DataFrame, label_col: str) -> dict:
    row: dict[str, object] = {"ticker": ticker}
    if frame.is_empty():
        return row

    latest = (
        frame.drop_nulls("value")
        .with_columns(pl.col("period_end").cast(pl.Utf8).str.slice(0, 10))
        .sort([label_col, "period_end"])
        .unique(subset=[label_col], keep="last")
    )
    for metric, value in latest.select([label_col, "value"]).iter_rows():
        row[metric] = value
    return row


def _filters(payload: dict) -> dict[str, tuple[str, float]]:
    filters = {}
    for item in payload.get("filters", []):
        metric = item.get("metric")
        op = item.get("op")
        raw_value = item.get("value")
        enabled = item.get("enabled", True)
        if not enabled or not metric or raw_value in (None, ""):
            continue
        filters[metric] = (op, float(raw_value))
    return filters


def _screener(payload: dict) -> dict:
    tickers = _tickers(payload.get("tickers"))
    if not tickers:
        raise ValueError("Enter tickers to screen.")
    include_metrics = [
        metric
        for metric in payload.get("include_metrics", [])
        if metric in _METRIC_GROUP
    ]
    df = screen_tickers(
        tickers,
        filters=_filters(payload),
        include_metrics=include_metrics,
        quarterly=bool(payload.get("quarterly", False)),
        max_workers=int(payload.get("max_workers", 4)),
    )
    return {"title": "Screener Results", "data": _jsonable(df)}


def _dcf(payload: dict) -> dict:
    tickers = _tickers(payload.get("tickers"))
    if not tickers:
        raise ValueError("Enter at least one ticker.")

    kwargs = {
        "auto": bool(payload.get("auto", False)),
        "forecast_years": int(payload.get("forecast_years", 5)),
        "discount_rate": _optional_rate(payload.get("discount_rate")),
        "terminal_growth_rate": _optional_rate(payload.get("terminal_growth_rate")),
        "growth_rate": _optional_rate(payload.get("growth_rate")),
        "max_growth_rate": _optional_rate(payload.get("max_growth_rate")),
    }
    if len(tickers) == 1 and not payload.get("compare", False):
        result = dcf(tickers[0], **kwargs)
        return {
            "title": f"{tickers[0]} DCF",
            "summary": _jsonable(result),
            "data": _jsonable(result.projections),
        }

    df = batch_dcf(
        tickers,
        max_workers=int(payload.get("max_workers", 4)),
        **kwargs,
    )
    return {"title": "DCF Comparison", "data": _jsonable(df)}


def _optional_rate(value):
    if value in (None, ""):
        return None
    return float(value) / 100


def _options() -> dict:
    metrics = sorted(_METRIC_GROUP)
    return {
        "metrics": metrics,
        "default_filters": [
            {"metric": "pe_ratio", "op": "<", "value": 30},
            {"metric": "gross_margin", "op": ">", "value": 0.4},
            {"metric": "operating_margin", "op": ">", "value": 0.15},
            {"metric": "revenue_growth", "op": ">", "value": 0.05},
        ],
    }


def _watchlist_csv(payload: dict) -> dict:
    content = payload.get("content", "")
    ticker_col = str(payload.get("ticker_column", "")).strip()
    if not content:
        raise ValueError("Upload a CSV file.")
    if not ticker_col:
        raise ValueError("Enter the ticker column name.")

    df = pl.read_csv(io.BytesIO(content.encode("utf-8")))
    if ticker_col not in df.columns:
        raise ValueError(
            f"Ticker column {ticker_col!r} not found. Available columns: {df.columns}"
        )

    tickers = _tickers(df[ticker_col].drop_nulls().cast(pl.Utf8).to_list())
    return {
        "columns": df.columns,
        "ticker_column": ticker_col,
        "tickers": tickers,
        "count": len(tickers),
    }


def _period_to_start(period: str) -> str | None:
    """Convert a yfinance-style period string to an ISO start date, or None for max."""
    import datetime as dt

    _PERIOD_DAYS = {
        "1d": 1,
        "5d": 5,
        "1mo": 30,
        "3mo": 90,
        "6mo": 180,
        "1y": 365,
        "2y": 730,
        "5y": 1825,
        "10y": 3650,
    }
    days = _PERIOD_DAYS.get(period)
    if days is None:
        return None  # "max" or unknown — return everything
    return (dt.date.today() - dt.timedelta(days=days)).isoformat()


def _candles(payload: dict) -> dict:
    from secrs.periphery.candles import Candles

    ticker = payload.get("ticker", "").strip().upper()
    interval = payload.get("interval", "1d")
    period = payload.get("period", "1y")
    if not ticker:
        raise ValueError("Enter a ticker.")

    indicators = bool(payload.get("indicators", False))
    start = _period_to_start(period)
    # Pass the original period so the Candles subclass can detect and backfill
    # missing history; start= trims the result to the requested window.
    df = Candles().get_candles([ticker], interval=interval, period=period, start=start)
    if df.is_empty():
        return {"columns": [], "rows": [], "height": 0, "width": 0}

    df = df.sort("date")
    if indicators:
        from yahoors.periphery.technical_analysis import add_indicators

        df = add_indicators(df)
    else:
        df = df.select(["date", "open", "high", "low", "close", "volume"])
    return _jsonable(df)


def _ticker_info(ticker: str) -> dict:
    from yahoors import Ticker as YTicker

    obj = YTicker(ticker)
    df = obj.info
    if df is None or df.is_empty():
        return {}
    row = df.row(0, named=True)
    # Normalise non-JSON-safe types to strings
    result = {}
    for k, v in row.items():
        if v is None:
            result[k] = None
        elif hasattr(v, "isoformat"):  # datetime / date
            result[k] = v.isoformat()
        elif isinstance(v, bool):
            result[k] = v
        elif isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            result[k] = None
        else:
            result[k] = v
    return result


_MARKETS_URLS = {
    "most_active": "https://finance.yahoo.com/markets/stocks/most-active/?start=0&count=100",
    "trending": "https://finance.yahoo.com/markets/stocks/trending/?start=0&count=100",
    "gainers": "https://finance.yahoo.com/markets/stocks/gainers/?start=0&count=100",
    "losers": "https://finance.yahoo.com/markets/stocks/losers/?start=0&count=100",
    "unusual_volume": "https://finance.yahoo.com/research-hub/screener/unusual-volume-stocks",
    "small_cap": "https://finance.yahoo.com/research-hub/screener/small-cap-stocks",
    "private_companies": "https://finance.yahoo.com/markets/private-companies/highest-valuation/",
    "commodities": "https://finance.yahoo.com/markets/commodities/",
    "world_indices": "https://finance.yahoo.com/markets/world-indices/",
    "ipo": "https://finance.yahoo.com/calendar/ipo",
}
_MARKETS_FALLBACK_URLS = {
    "unusual_volume": [
        "https://finance.yahoo.com/research-hub/screener/unusual-volume-stocks/",
    ],
    "small_cap": [
        "https://finance.yahoo.com/research-hub/screener/small-cap-stocks/",
    ],
}
_MARKETS_CACHE_TTL_SECONDS = 120
_MARKETS_STALE_WARNING = "Yahoo Finance refresh failed; showing cached market data."
_IPO_LOOKAHEAD_DAYS = 30
_MARKETS_CACHE: dict[str, dict] = {}
_MARKETS_LOCKS = {sub: Lock() for sub in _MARKETS_URLS}
_DASHBOARD_INDEXES = {
    "^IXIC": "Nasdaq",
    "^GSPC": "S&P 500",
    "^DJI": "Dow",
    "^RUT": "Russell 2000",
}
_DASHBOARD_FUTURES = {
    "ES=F": "S&P Futures",
    "CL=F": "Crude Oil",
    "BZ=F": "Brent Oil",
    "GC=F": "Gold",
    "NG=F": "Natural Gas",
    "BTC-USD": "Bitcoin",
}
_DASHBOARD_INDEX_CACHE_TTL_SECONDS = 60
_DASHBOARD_INDEX_CACHE: dict | None = None
_DASHBOARD_INDEX_LOCK = Lock()
_DASHBOARD_FUTURES_CACHE_TTL_SECONDS = 60
_DASHBOARD_FUTURES_CACHE: dict | None = None
_DASHBOARD_FUTURES_LOCK = Lock()
_ET_TZ = ZoneInfo("America/New_York")
_PRE_MARKET_OPEN = dt.time(4, 0)
_MARKET_OPEN = dt.time(9, 30)
_MARKET_CLOSE = dt.time(16, 0)
_POST_MARKET_CLOSE = dt.time(20, 0)


def _markets_cache_response(sub: str, status: str, warning: str | None = None) -> dict:
    entry = _MARKETS_CACHE[sub]
    payload = copy.deepcopy(entry["payload"])
    warning = warning or entry.get("warning")
    payload["cache"] = {
        "status": status,
        "age_seconds": max(0, round(time.time() - entry["fetched_at"])),
        "ttl_seconds": _MARKETS_CACHE_TTL_SECONDS,
    }
    if warning:
        payload["warning"] = warning
    return payload


def _is_market_day(day: dt.date) -> bool:
    return day.weekday() < 5 and day not in _get_us_market_holidays(day.year)


def _previous_market_day(day: dt.date) -> dt.date:
    candidate = day - dt.timedelta(days=1)
    for _ in range(10):
        if _is_market_day(candidate):
            return candidate
        candidate -= dt.timedelta(days=1)
    return candidate


def _next_market_day(day: dt.date) -> dt.date:
    candidate = day + dt.timedelta(days=1)
    for _ in range(10):
        if _is_market_day(candidate):
            return candidate
        candidate += dt.timedelta(days=1)
    return candidate


def _at_market_time(day: dt.date, value: dt.time) -> dt.datetime:
    return dt.datetime.combine(day, value, tzinfo=_ET_TZ)


def _market_session_date(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(_ET_TZ)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    et = now.astimezone(_ET_TZ)
    day = et.date()
    if _is_market_day(day) and et.time() >= _MARKET_OPEN:
        return day.isoformat()
    return _previous_market_day(day).isoformat()


def _calendar_date(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(_ET_TZ)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(_ET_TZ).date().isoformat()


def _markets_cache_date(sub: str, now: dt.datetime | None = None) -> str:
    if sub == "ipo":
        return _calendar_date(now)
    return _market_session_date(now)


def _regular_market_is_open(now: dt.datetime | None = None) -> bool:
    now = now or dt.datetime.now(_ET_TZ)
    et = now.astimezone(_ET_TZ)
    return _is_market_day(et.date()) and _MARKET_OPEN <= et.time() < _MARKET_CLOSE


def _market_status(now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(_ET_TZ)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    et = now.astimezone(_ET_TZ)
    day = et.date()
    current_time = et.time()

    if not _is_market_day(day):
        next_day = _next_market_day(day)
        phase = "closed"
        label = "Market Closed"
        target_label = "pre-market opens"
        target = _at_market_time(next_day, _PRE_MARKET_OPEN)
    elif current_time < _PRE_MARKET_OPEN:
        phase = "closed"
        label = "Market Closed"
        target_label = "pre-market opens"
        target = _at_market_time(day, _PRE_MARKET_OPEN)
    elif current_time < _MARKET_OPEN:
        phase = "pre_market"
        label = "Pre-Market"
        target_label = "market opens"
        target = _at_market_time(day, _MARKET_OPEN)
    elif current_time < _MARKET_CLOSE:
        phase = "open"
        label = "Market Open"
        target_label = "market closes"
        target = _at_market_time(day, _MARKET_CLOSE)
    elif current_time < _POST_MARKET_CLOSE:
        phase = "post_market"
        label = "Post-Market"
        target_label = "post-market closes"
        target = _at_market_time(day, _POST_MARKET_CLOSE)
    else:
        next_day = _next_market_day(day)
        phase = "closed"
        label = "Market Closed"
        target_label = "pre-market opens"
        target = _at_market_time(next_day, _PRE_MARKET_OPEN)

    return {
        "phase": phase,
        "is_open": phase == "open",
        "label": label,
        "target_label": target_label,
        "now": et.isoformat(),
        "target": target.isoformat(),
        "timezone": "America/New_York",
    }


def _read_market_cache(sub: str, market_date: str | None = None) -> dict | None:
    from secrs.data.db import init_tables

    conn = init_tables()
    try:
        if market_date:
            row = conn.execute(
                """
                SELECT market_date, fetched_at, payload_json
                  FROM market_cache
                 WHERE sub = ? AND market_date = ?
                 LIMIT 1
                """,
                [sub, market_date],
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT market_date, fetched_at, payload_json
                  FROM market_cache
                 WHERE sub = ?
                 ORDER BY market_date DESC, fetched_at DESC
                 LIMIT 1
                """,
                [sub],
            ).fetchone()
    finally:
        conn.close()

    if not row:
        return None
    return {
        "market_date": row[0],
        "fetched_at": row[1],
        "payload": json.loads(row[2]),
    }


def _write_market_cache(sub: str, market_date: str, payload: dict) -> None:
    from secrs.data.db import init_tables

    conn = init_tables()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO market_cache
                (sub, market_date, fetched_at, payload_json)
            VALUES (?, ?, ?, ?)
            """,
            [
                sub,
                market_date,
                dt.datetime.now(dt.timezone.utc).isoformat(),
                json.dumps(payload),
            ],
        )
        conn.commit()
    finally:
        conn.close()


def _database_markets_response(
    sub: str,
    row: dict,
    status: str = "database",
    warning: str | None = None,
) -> dict:
    payload = copy.deepcopy(row["payload"])
    payload["cache"] = {
        "status": status,
        "market_date": row["market_date"],
        "ttl_seconds": None,
    }
    if warning:
        payload["warning"] = warning
    return payload


def _fetch_markets(sub: str) -> dict:
    url = _MARKETS_URLS.get(sub)
    if not url:
        raise ValueError(f"Unknown markets sub-tab: {sub}")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    if sub == "ipo":
        return _fetch_ipo_calendar(_calendar_date(), headers)

    urls = [url, *_MARKETS_FALLBACK_URLS.get(sub, [])]
    errors: list[str] = []
    tables = []
    for candidate in urls:
        try:
            html = _fetch_yahoo_html(candidate, headers)
            tables = pd.read_html(io.StringIO(html))
            if tables:
                break
            errors.append(f"{candidate}: no table found")
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    if not tables:
        raise ValueError("No market table found. Tried " + "; ".join(errors))

    df = tables[0]
    df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
    df = _clean_market_table(df)
    title_map = {
        "most_active": "Most Active",
        "trending": "Trending",
        "gainers": "Top Gainers",
        "losers": "Top Losers",
        "unusual_volume": "Unusual Volume",
        "small_cap": "Small Cap",
        "commodities": "Commodities",
        "world_indices": "World Indices",
        "ipo": "IPO",
        "private_companies": "Private Companies",
    }
    return {"title": title_map[sub], "data": _jsonable(df)}


def _fetch_ipo_calendar(day: str, headers: dict[str, str]) -> dict:
    date_value = dt.date.fromisoformat(day)
    month_start = date_value.replace(day=1)
    if date_value.month == 12:
        next_month = date_value.replace(year=date_value.year + 1, month=1, day=1)
    else:
        next_month = date_value.replace(month=date_value.month + 1, day=1)
    month_end = next_month - dt.timedelta(days=1)
    url = (
        f"{_MARKETS_URLS['ipo']}?from={month_start.isoformat()}"
        f"&to={month_end.isoformat()}&day={date_value.isoformat()}"
    )
    html = _fetch_yahoo_html(url, headers)
    tables = pd.read_html(io.StringIO(html))
    if not tables:
        raise ValueError(f"No IPO calendar table found for {day}.")

    df = tables[0]
    df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
    df = _clean_market_table(df)
    return {"title": f"IPO Calendar · {day}", "data": _jsonable(df)}


def _upcoming_ipo_calendar() -> dict:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    start = dt.datetime.now(_ET_TZ).date()
    end = start + dt.timedelta(days=_IPO_LOOKAHEAD_DAYS)
    rows: list[dict] = []
    columns: list[str] = []
    fetched = 0
    cached = 0
    errors: list[str] = []

    for offset in range(_IPO_LOOKAHEAD_DAYS + 1):
        day = start + dt.timedelta(days=offset)
        if not _is_market_day(day):
            continue

        day_key = day.isoformat()
        row = _read_market_cache("ipo", day_key)
        if row:
            payload = row["payload"]
            cached += 1
        else:
            try:
                payload = _fetch_ipo_calendar(day_key, headers)
                _write_market_cache("ipo", day_key, payload)
                fetched += 1
            except Exception as exc:
                if _is_empty_ipo_error(exc):
                    payload = _empty_ipo_payload(day_key)
                    _write_market_cache("ipo", day_key, payload)
                    fetched += 1
                else:
                    errors.append(f"{day_key}: {exc}")
                    continue

        data = payload.get("data", {})
        day_columns = data.get("columns", [])
        if day_columns and not columns:
            columns = day_columns
        rows.extend(data.get("rows", []))

    rows = _dedupe_ipo_rows(rows)
    rows.sort(
        key=lambda item: (str(item.get("Date") or ""), str(item.get("Symbol") or ""))
    )

    if not columns:
        columns = [
            "Symbol",
            "Company",
            "Exchange",
            "Date",
            "Price Range",
            "Price",
            "Currency",
            "Shares",
            "Actions",
        ]

    payload = {
        "title": f"Upcoming IPOs · {start.isoformat()} to {end.isoformat()}",
        "data": {
            "columns": columns,
            "rows": rows,
            "height": len(rows),
            "width": len(columns),
        },
        "ipo_window": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "lookahead_days": _IPO_LOOKAHEAD_DAYS,
            "fetched_days": fetched,
            "cached_days": cached,
        },
    }
    if errors and not rows:
        raise ValueError("No IPO calendar data found. Tried " + "; ".join(errors))
    if errors:
        payload["warning"] = f"Some IPO dates failed to refresh ({len(errors)})."
    return payload


def _dedupe_ipo_rows(rows: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for row in rows:
        key = (
            str(row.get("Symbol") or "").strip(),
            str(row.get("Company") or "").strip(),
            str(row.get("Date") or "").strip(),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def _empty_ipo_payload(day: str) -> dict:
    columns = [
        "Symbol",
        "Company",
        "Exchange",
        "Date",
        "Price Range",
        "Price",
        "Currency",
        "Shares",
        "Actions",
    ]
    return {
        "title": f"IPO Calendar · {day}",
        "data": {
            "columns": columns,
            "rows": [],
            "height": 0,
            "width": len(columns),
        },
    }


def _is_empty_ipo_error(exc: Exception) -> bool:
    text = str(exc)
    return "404" in text or "No IPO calendar table found" in text or "html5lib" in text


def _clean_market_table(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "Symbol" in df.columns:
        df["Symbol"] = df["Symbol"].map(_clean_market_symbol)
    return df


def _clean_market_symbol(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    parts = text.split()
    if len(parts) >= 2 and len(parts[0]) == 1:
        return parts[1]
    return parts[0] if parts else ""


def _fetch_yahoo_html(url: str, headers: dict[str, str]) -> str:
    try:
        from curl_cffi import requests as curl_requests

        resp = curl_requests.get(
            url,
            headers={
                **headers,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            impersonate="chrome",
            timeout=15,
        )
    except ImportError:
        import requests

        resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.text


def _markets(sub: str) -> dict:
    if sub not in _MARKETS_URLS:
        raise ValueError(f"Unknown markets sub-tab: {sub}")

    if sub == "ipo":
        return _ipo_markets()

    market_date = _markets_cache_date(sub)
    market_open = _regular_market_is_open()

    entry = _MARKETS_CACHE.get(sub)
    if (
        entry
        and time.time() - entry.get("checked_at", entry["fetched_at"])
        < _MARKETS_CACHE_TTL_SECONDS
    ):
        return _markets_cache_response(sub, "stale" if entry.get("warning") else "hit")

    with _MARKETS_LOCKS[sub]:
        if sub == "ipo":
            row = _read_market_cache(sub, market_date)
            if row:
                return _database_markets_response(sub, row, "database-calendar")

        if not market_open:
            row = _read_market_cache(sub, market_date)
            if row:
                return _database_markets_response(sub, row, "database-closed")

        entry = _MARKETS_CACHE.get(sub)
        if (
            entry
            and time.time() - entry.get("checked_at", entry["fetched_at"])
            < _MARKETS_CACHE_TTL_SECONDS
        ):
            return _markets_cache_response(
                sub, "stale" if entry.get("warning") else "hit"
            )

        try:
            now = time.time()
            payload = _fetch_markets(sub)
            _write_market_cache(sub, market_date, payload)
            _MARKETS_CACHE[sub] = {
                "fetched_at": now,
                "checked_at": now,
                "payload": payload,
            }
            return _markets_cache_response(sub, "refresh")
        except Exception:
            if entry:
                entry["checked_at"] = time.time()
                entry["warning"] = _MARKETS_STALE_WARNING
                return _markets_cache_response(sub, "stale")
            row = _read_market_cache(sub)
            if row:
                return _database_markets_response(
                    sub,
                    row,
                    "database-stale",
                    _MARKETS_STALE_WARNING,
                )
            raise


def _ipo_markets() -> dict:
    entry = _MARKETS_CACHE.get("ipo")
    if (
        entry
        and time.time() - entry.get("checked_at", entry["fetched_at"])
        < _MARKETS_CACHE_TTL_SECONDS
    ):
        return _markets_cache_response(
            "ipo", "stale" if entry.get("warning") else "hit"
        )

    with _MARKETS_LOCKS["ipo"]:
        entry = _MARKETS_CACHE.get("ipo")
        if (
            entry
            and time.time() - entry.get("checked_at", entry["fetched_at"])
            < _MARKETS_CACHE_TTL_SECONDS
        ):
            return _markets_cache_response(
                "ipo", "stale" if entry.get("warning") else "hit"
            )

        try:
            now = time.time()
            payload = _upcoming_ipo_calendar()
            _MARKETS_CACHE["ipo"] = {
                "fetched_at": now,
                "checked_at": now,
                "payload": payload,
            }
            return _markets_cache_response("ipo", "refresh")
        except Exception:
            if entry:
                entry["checked_at"] = time.time()
                entry["warning"] = _MARKETS_STALE_WARNING
                return _markets_cache_response("ipo", "stale")
            raise


def _dashboard_indexes() -> dict:
    global _DASHBOARD_INDEX_CACHE

    if (
        _DASHBOARD_INDEX_CACHE
        and time.time() - _DASHBOARD_INDEX_CACHE["fetched_at"]
        < _DASHBOARD_INDEX_CACHE_TTL_SECONDS
    ):
        return _dashboard_index_cache_response("hit")

    with _DASHBOARD_INDEX_LOCK:
        if (
            _DASHBOARD_INDEX_CACHE
            and time.time() - _DASHBOARD_INDEX_CACHE["fetched_at"]
            < _DASHBOARD_INDEX_CACHE_TTL_SECONDS
        ):
            return _dashboard_index_cache_response("hit")

        try:
            payload = _fetch_dashboard_indexes()
            _DASHBOARD_INDEX_CACHE = {
                "fetched_at": time.time(),
                "payload": payload,
            }
            return _dashboard_index_cache_response("refresh")
        except Exception:
            if _DASHBOARD_INDEX_CACHE:
                payload = _dashboard_index_cache_response("stale")
                payload["warning"] = "Index refresh failed; showing cached index data."
                return payload
            raise


def _dashboard_index_cache_response(status: str) -> dict:
    if not _DASHBOARD_INDEX_CACHE:
        raise ValueError("Index cache is empty.")
    payload = copy.deepcopy(_DASHBOARD_INDEX_CACHE["payload"])
    payload["cache"] = {
        "status": status,
        "age_seconds": max(
            0, round(time.time() - _DASHBOARD_INDEX_CACHE["fetched_at"])
        ),
        "ttl_seconds": _DASHBOARD_INDEX_CACHE_TTL_SECONDS,
    }
    return payload


def _fetch_dashboard_indexes() -> dict:
    return {"indexes": _fetch_dashboard_quote_items(_DASHBOARD_INDEXES)}


def _dashboard_futures() -> dict:
    global _DASHBOARD_FUTURES_CACHE

    if (
        _DASHBOARD_FUTURES_CACHE
        and time.time() - _DASHBOARD_FUTURES_CACHE["fetched_at"]
        < _DASHBOARD_FUTURES_CACHE_TTL_SECONDS
    ):
        return _dashboard_futures_cache_response("hit")

    with _DASHBOARD_FUTURES_LOCK:
        if (
            _DASHBOARD_FUTURES_CACHE
            and time.time() - _DASHBOARD_FUTURES_CACHE["fetched_at"]
            < _DASHBOARD_FUTURES_CACHE_TTL_SECONDS
        ):
            return _dashboard_futures_cache_response("hit")

        try:
            payload = _fetch_dashboard_futures()
            _DASHBOARD_FUTURES_CACHE = {
                "fetched_at": time.time(),
                "payload": payload,
            }
            return _dashboard_futures_cache_response("refresh")
        except Exception:
            if _DASHBOARD_FUTURES_CACHE:
                payload = _dashboard_futures_cache_response("stale")
                payload["warning"] = (
                    "Futures refresh failed; showing cached futures data."
                )
                return payload
            raise


def _dashboard_futures_cache_response(status: str) -> dict:
    if not _DASHBOARD_FUTURES_CACHE:
        raise ValueError("Futures cache is empty.")
    payload = copy.deepcopy(_DASHBOARD_FUTURES_CACHE["payload"])
    payload["cache"] = {
        "status": status,
        "age_seconds": max(
            0, round(time.time() - _DASHBOARD_FUTURES_CACHE["fetched_at"])
        ),
        "ttl_seconds": _DASHBOARD_FUTURES_CACHE_TTL_SECONDS,
    }
    return payload


def _fetch_dashboard_futures() -> dict:
    return {"items": _fetch_dashboard_quote_items(_DASHBOARD_FUTURES)}


def _fetch_dashboard_quote_items(symbol_names: dict[str, str]) -> list[dict]:
    from secrs.periphery.candles import Candles

    symbols = list(symbol_names)
    df = Candles().get_candles(symbols, interval="1d", period="5d")
    if df.is_empty():
        return []

    rows = df.sort("date").to_dicts()
    by_symbol: dict[str, list[dict]] = {symbol: [] for symbol in symbols}
    for row in rows:
        ticker = str(row.get("ticker") or row.get("symbol") or "").upper()
        if ticker in by_symbol and row.get("close") is not None:
            by_symbol[ticker].append(row)

    items = []
    for symbol, name in symbol_names.items():
        series = by_symbol.get(symbol, [])
        if not series:
            continue
        latest = series[-1]
        previous = series[-2] if len(series) >= 2 else None
        close = latest.get("close")
        prev_close = previous.get("close") if previous else None
        change_pct = None
        if close is not None and prev_close:
            change_pct = ((float(close) - float(prev_close)) / float(prev_close)) * 100
        items.append(
            {
                "symbol": symbol,
                "name": name,
                "close": close,
                "change_pct": change_pct,
                "date": latest.get("date"),
            }
        )

    return items


API_HANDLERS = {
    "/api/ticker-financials": _single,
    "/api/multi": _multi,
    "/api/screener": _screener,
    "/api/dcf": _dcf,
    "/api/watchlist/csv": _watchlist_csv,
    "/api/candles": _candles,
}


class UIHandler(BaseHTTPRequestHandler):
    server_version = "secrs-ui/0.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/options":
            self._send_json(_options())
            return
        if path == "/api/search":
            q = parse_qs(parsed.query).get("q", [""])[0]
            self._send_json(_search(q))
            return
        if path == "/api/ticker-info":
            ticker = parse_qs(parsed.query).get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_ticker_info(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/market-status":
            self._send_json(_market_status())
            return
        if path == "/api/chat/providers":
            self._send_json(_chat_providers())
            return
        if path == "/api/web-search":
            q = parse_qs(parsed.query).get("q", [""])[0].strip()
            if not q:
                self._send_json(
                    {"error": "Missing query"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_web_search(q))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/dashboard-indexes":
            try:
                self._send_json(_dashboard_indexes())
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/dashboard-futures":
            try:
                self._send_json(_dashboard_futures())
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/markets":
            sub = parse_qs(parsed.query).get("sub", ["most_active"])[0]
            try:
                self._send_json(_markets(sub))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path in PAGE_ROUTES or path.startswith("/ticker/"):
            self._send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
            return

        static_path = (STATIC_DIR / path.removeprefix("/static/")).resolve()
        if path.startswith("/static/") and static_path.is_relative_to(STATIC_DIR):
            if static_path.is_file():
                content_type = (
                    mimetypes.guess_type(static_path)[0] or "application/octet-stream"
                )
                self._send_file(static_path, content_type)
                return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/chat/deep-research":
            payload = self._read_json()
            try:
                self._send_sse_stream(_deep_research_stream(payload))
            except Exception as exc:
                print(f"[deep-research] error: {exc}", flush=True)
            return
        if path in ("/api/chat/claude", "/api/chat/openai"):
            payload = self._read_json()
            provider = "claude" if path.endswith("claude") else "openai"
            key_var = (
                "SECRS_CLAUDE_API_KEY"
                if provider == "claude"
                else "SECRS_OPENAI_API_KEY"
            )
            if not os.environ.get(key_var):
                self._send_json(
                    {"error": f"{key_var} environment variable not set"},
                    status=HTTPStatus.BAD_REQUEST,
                )
                return
            try:
                gen = (
                    _stream_claude(payload)
                    if provider == "claude"
                    else _stream_openai(payload)
                )
                self._send_sse_stream(gen)
            except Exception as exc:
                print(f"[chat] stream error: {exc}", flush=True)
            return
        handler = API_HANDLERS.get(path)
        if handler is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            payload = self._read_json()
            self._send_json(handler(payload))
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(_jsonable(payload), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_sse_stream(self, gen):
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache")
        self.send_header("x-accel-buffering", "no")
        self.end_headers()
        try:
            for chunk in gen:
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def run(host: str = "127.0.0.1", port: int = 8765):
    httpd = ThreadingHTTPServer((host, port), UIHandler)
    print(f"StockLens UI running at http://{host}:{port}")
    httpd.serve_forever()


def main():
    parser = argparse.ArgumentParser(description="Run the StockLens web UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    run(args.host, args.port)
