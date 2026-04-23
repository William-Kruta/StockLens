from __future__ import annotations

import argparse
import copy
import datetime as dt
import io
import json
import math
import mimetypes
import os
import tempfile
import time
from dataclasses import asdict, is_dataclass
from contextlib import redirect_stderr, redirect_stdout
from multiprocessing import Process
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Thread
from urllib.parse import urlparse, parse_qs
from uuid import uuid4
from zoneinfo import ZoneInfo

import polars as pl
import pandas as pd
import yfinance as yf

from geckors import Token as GeckoToken
from insidertracker import InsiderTracker
from llm.toolchain import Toolchain
from secrs.dcf import batch_dcf, dcf
from secrs.modules.margins import _calculate_margin_table
from secrs.modules.ratios import _calculate_ratio_table
from secrs.periphery.revenues import get_revenue_by_region, get_revenue_by_segment
from secrs.screener import _METRIC_GROUP, screen_tickers
from secrs.ticker import Ticker, Tickers
from secrs.utils.stale import _get_us_market_holidays
from data.kalshi import (
    cache_stats as _kalshi_cache_stats,
    get_event as _kalshi_get_event,
    get_events as _kalshi_get_events,
    get_market as _kalshi_get_market,
    get_market_candlesticks as _kalshi_get_market_candlesticks,
    get_market_orderbook as _kalshi_get_market_orderbook,
    get_markets as _kalshi_get_markets,
    get_series as _kalshi_get_series,
)
from yahoors.modules.socket import WebSocket


STATIC_DIR = Path(__file__).parent / "static"
MODULES_DIR = Path(__file__).parent / "modules"
PAGE_ROUTES = {
    "/",
    "/chat",
    "/dashboard",
    "/markets",
    "/multi",
    "/watchlist",
    "/screener",
    "/option-screener",
    "/dcf",
}
_INTRADAY_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}
_LIVE_SESSION_LOCK = Lock()
_LIVE_SESSIONS: dict[str, "_LiveCandleSession"] = {}
_CANDLE_CACHE_LOCK = Lock()
_CANDLE_BASE_CACHE: dict[tuple[str, str, str, str | None], tuple[float, pl.DataFrame]] = {}
_CHAT_TOOLCHAIN: Toolchain | None = None


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


def _deep_research_config(effort: str) -> dict:
    normalized = str(effort).strip().lower()
    if normalized not in {"default", "high", "extreme"}:
        normalized = "default"
    if normalized == "extreme":
        return {
            "name": "extreme",
            "max_queries": 6,
            "search_results_per_query": 8,
            "followup_query_count": 4,
            "followup_results_per_query": 6,
            "has_followup_wave": True,
            "is_iterative": True,
            "max_loops": 3,
            "planner_hint": (
                "Generate 4-6 highly specific starting queries. Bias toward official sources, catalysts, "
                "SEC filings, earnings, guidance, analyst actions, and precise date-bounded searches."
            ),
            "synthesis_system": (
                "You are a senior research analyst. Use the accumulated evidence ledger to produce a structured answer. "
                "Focus on the best-supported conclusion, alternate explanations, unresolved gaps, and confidence. "
            ),
        }
    if normalized == "high":
        return {
            "name": "high",
            "max_queries": 8,
            "search_results_per_query": 8,
            "followup_query_count": 4,
            "followup_results_per_query": 6,
            "has_followup_wave": True,
            "is_iterative": False,
            "max_loops": 1,
            "planner_hint": (
                "Generate 5-8 highly specific queries. Bias toward catalysts, official sources, "
                "SEC filings, press releases, analyst notes, earnings, guidance, and dated follow-up checks."
            ),
            "synthesis_system": (
                "You are a senior research analyst. Synthesize the evidence into a structured answer. "
                "Focus on likely catalysts, supporting evidence, contradictory evidence, timeline, "
                "and confidence. If the evidence is weak, say so explicitly. "
            ),
        }
    return {
        "name": "default",
        "max_queries": 5,
        "search_results_per_query": 5,
        "followup_query_count": 0,
        "followup_results_per_query": 0,
        "has_followup_wave": False,
        "is_iterative": False,
        "max_loops": 1,
        "planner_hint": (
            "Generate 3-5 specific web search queries. Only set needs_clarification=true if the question is fundamentally ambiguous."
        ),
        "synthesis_system": (
            "You are a research analyst. Synthesize web search results into a comprehensive, well-structured answer. "
            "Cite sources where relevant. Be thorough and accurate. "
        ),
    }


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen = set()
    output = []
    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def _search_results_excerpt(all_results: list[dict], max_items_per_query: int = 2) -> str:
    parts = []
    for item in all_results:
        results = item.get("results") or []
        if not results:
            continue
        parts.append(f'\n[Search results for: "{item["query"]}"]\n')
        for j, result in enumerate(results[:max_items_per_query]):
            parts.append(
                f'{j + 1}. {result["title"]}\n   {result["snippet"]}\n   {result["url"]}\n'
            )
    return "".join(parts)


def _evidence_ledger_excerpt(entries: list[dict], max_entries: int = 8) -> str:
    if not entries:
        return ""
    parts = []
    for entry in entries[:max_entries]:
        parts.append(
            f'- Loop {entry.get("loop")}, query "{entry.get("query", "")}": '
            f'{entry.get("title", "")} | {entry.get("url", "")}\n'
            f'  {entry.get("snippet", "")}\n'
        )
    return "".join(parts)


def _safe_json_loads(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _run_search_queries(
    queries: list[str],
    *,
    all_results: list[dict],
    search_ok: bool,
    max_results: int,
    base_index: int = 0,
    total_override: int | None = None,
):
    for i, query in enumerate(queries):
        total = total_override or len(queries)
        yield f"data: {json.dumps({'type': 'searching', 'query': query, 'index': base_index + i + 1, 'total': total})}\n\n"
        if search_ok:
            try:
                results = _web_search(query, max_results=max_results)
                all_results.append({"query": query, "results": results})
                yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': len(results)})}\n\n"
            except Exception:
                search_ok = False
                all_results.append({"query": query, "results": []})
                yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': 0})}\n\n"
        else:
            all_results.append({"query": query, "results": []})
            yield f"data: {json.dumps({'type': 'search_done', 'query': query, 'count': 0})}\n\n"
    return search_ok


def _derive_extreme_next_step(
    *,
    user_question: str,
    loop_index: int,
    all_results: list[dict],
    evidence_ledger: list[dict],
    visited_queries: list[str],
    model: str,
    provider: str,
    api_key: str,
    llama_url: str,
) -> dict:
    system = (
        "You are coordinating a multi-step research agent. Review the current evidence and decide the single highest-value next topic. "
        "Respond ONLY with raw JSON in this exact format:\n"
        '{"continue_research": true, "reason": "one-line reason", "next_queries": ["q1","q2"], "evidence_summary": "short evidence summary", "confidence": "low"}\n'
        "Rules:\n"
        "- Choose 1-3 next queries max.\n"
        "- Only continue if the next queries would materially reduce uncertainty.\n"
        "- Prefer confirming the leading hypothesis, resolving contradictions, or filling one critical gap.\n"
        "- If evidence is already strong enough, set continue_research=false."
    )
    user = (
        f"Original question:\n{user_question}\n\n"
        f"Current loop: {loop_index}\n\n"
        f"Visited queries:\n" + "\n".join(f"- {q}" for q in visited_queries[:20]) + "\n\n"
        f"Evidence ledger:\n{_evidence_ledger_excerpt(evidence_ledger, max_entries=10)}\n\n"
        f"Recent search results:\n{_search_results_excerpt(all_results[-6:], max_items_per_query=2)}"
    )
    try:
        raw = _call_llm_sync(
            [{"role": "user", "content": user}],
            model,
            provider,
            api_key,
            system,
            llama_url,
        )
        decision = _safe_json_loads(raw)
    except Exception:
        recent_queries = [item["query"] for item in all_results[-2:] if item.get("query")]
        seed = recent_queries[-1] if recent_queries else user_question
        decision = {
            "continue_research": loop_index < 2,
            "reason": "Fallback next-step selection.",
            "next_queries": [f"{seed} official source", f"{seed} filing"][:2],
            "evidence_summary": "",
            "confidence": "low",
        }
    decision["next_queries"] = _dedupe_preserve_order(
        [str(q).strip() for q in (decision.get("next_queries") or [])]
    )[:3]
    return decision


def _deep_research_stream(payload: dict):
    payload = _prepare_chat_payload(payload)
    tool_calls = payload.get("tool_calls") or []
    if tool_calls:
        yield f"data: {json.dumps({'type': 'tool_context', 'tool_calls': tool_calls})}\n\n"
    provider = payload.get("provider", "claude")
    model = payload.get("model", "claude-sonnet-4-6")
    messages = payload.get("messages", [])
    llama_url = payload.get("llamaUrl", "http://localhost:8080")
    effort = payload.get("effort", "default")
    cfg = _deep_research_config(effort)

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
        '{"needs_clarification": false, "clarification": null, "queries": ["q1","q2","q3"], "plan": "one-line description", "followup_queries": []}\n'
        f"{cfg['planner_hint']}"
    )
    try:
        raw = _call_llm_sync(
            conv_messages, model, provider, api_key, planning_system, llama_url
        )
        plan = _safe_json_loads(raw)
    except Exception:
        plan = {
            "needs_clarification": False,
            "queries": [user_question[:120]],
            "plan": "Direct search",
            "followup_queries": [],
        }

    if plan.get("needs_clarification") and plan.get("clarification"):
        yield f"data: {json.dumps({'type': 'clarification', 'text': plan['clarification']})}\n\n"
        yield "data: [DONE]\n\n"
        return

    planned_queries = plan.get("queries") or [user_question]
    queries = _dedupe_preserve_order([str(q).strip() for q in planned_queries])[: cfg["max_queries"]]
    yield f"data: {json.dumps({'type': 'plan', 'queries': queries, 'description': plan.get('plan', '')})}\n\n"

    # ── Phase 2: Search ───────────────────────────────────────────
    all_results = []
    evidence_ledger = []
    search_ok = True
    visited_queries = list(queries)
    search_ok = yield from _run_search_queries(
        queries,
        all_results=all_results,
        search_ok=search_ok,
        max_results=cfg["search_results_per_query"],
    )
    for item in all_results:
        for result in item.get("results") or []:
            evidence_ledger.append(
                {
                    "loop": 1,
                    "query": item.get("query", ""),
                    "title": result.get("title", ""),
                    "snippet": result.get("snippet", ""),
                    "url": result.get("url", ""),
                }
            )

    if cfg["is_iterative"]:
        current_queries = list(queries)
        for loop_index in range(1, cfg["max_loops"]):
            yield f"data: {json.dumps({'type': 'status', 'text': f'Loop {loop_index + 1}: reviewing evidence...'})}\n\n"
            decision = _derive_extreme_next_step(
                user_question=user_question,
                loop_index=loop_index + 1,
                all_results=all_results,
                evidence_ledger=evidence_ledger,
                visited_queries=visited_queries,
                model=model,
                provider=provider,
                api_key=api_key,
                llama_url=llama_url,
            )
            summary = (decision.get("evidence_summary") or "").strip()
            if summary:
                yield f"data: {json.dumps({'type': 'status', 'text': f'Loop {loop_index + 1}: {summary[:180]}'})}\n\n"

            next_queries = [
                q for q in (decision.get("next_queries") or []) if q.strip().lower() not in {v.lower() for v in visited_queries}
            ]
            should_continue = bool(decision.get("continue_research")) and bool(next_queries)
            if not should_continue:
                break

            visited_queries.extend(next_queries)
            yield f"data: {json.dumps({'type': 'status', 'text': f'Loop {loop_index + 1}: exploring next topic...'})}\n\n"
            start_idx = len(all_results)
            search_ok = yield from _run_search_queries(
                next_queries,
                all_results=all_results,
                search_ok=search_ok,
                max_results=cfg["search_results_per_query"],
                base_index=start_idx,
                total_override=start_idx + len(next_queries),
            )
            for item in all_results[start_idx:]:
                for result in item.get("results") or []:
                    evidence_ledger.append(
                        {
                            "loop": loop_index + 1,
                            "query": item.get("query", ""),
                            "title": result.get("title", ""),
                            "snippet": result.get("snippet", ""),
                            "url": result.get("url", ""),
                        }
                    )
            current_queries = next_queries

    elif cfg["has_followup_wave"]:
        yield f"data: {json.dumps({'type': 'status', 'text': 'Expanding search...'})}\n\n"
        followup_planned = plan.get("followup_queries") or []
        followup_queries = _dedupe_preserve_order([str(q).strip() for q in followup_planned])
        if not followup_queries:
            followup_system = (
                "You are a research analyst. Based on the question and initial search results, "
                "produce 2-4 additional targeted search queries that are most likely to uncover the catalyst, "
                "supporting filings, or official explanations. Respond ONLY with raw JSON: "
                '{"followup_queries": ["q1","q2"]}'
            )
            followup_user = (
                f"Question:\n{user_question}\n\n"
                f"Initial search results:\n{_search_results_excerpt(all_results, max_items_per_query=2)}"
            )
            try:
                raw_followup = _call_llm_sync(
                    [{"role": "user", "content": followup_user}],
                    model,
                    provider,
                    api_key,
                    followup_system,
                    llama_url,
                )
                followup_plan = _safe_json_loads(raw_followup)
                followup_planned = followup_plan.get("followup_queries") or []
                followup_queries = _dedupe_preserve_order(
                    [str(q).strip() for q in followup_planned]
                )
            except Exception:
                followup_queries = []

        if not followup_queries:
            seed_terms = [
                "news",
                "earnings",
                "guidance",
                "SEC filing",
                "press release",
                "analyst upgrade",
                "analyst downgrade",
                "catalyst",
            ]
            for base_query in queries[:2]:
                for term in seed_terms:
                    followup_queries.append(f"{base_query} {term}")
            followup_queries = _dedupe_preserve_order(followup_queries)[: cfg["followup_query_count"]]
        else:
            followup_queries = followup_queries[: cfg["followup_query_count"]]

        start_idx = len(all_results)
        search_ok = yield from _run_search_queries(
            followup_queries,
            all_results=all_results,
            search_ok=search_ok,
            max_results=cfg["followup_results_per_query"],
            base_index=start_idx,
            total_override=len(queries) + len(followup_queries),
        )
        for item in all_results[start_idx:]:
            for result in item.get("results") or []:
                evidence_ledger.append(
                    {
                        "loop": 2,
                        "query": item.get("query", ""),
                        "title": result.get("title", ""),
                        "snippet": result.get("snippet", ""),
                        "url": result.get("url", ""),
                    }
                )

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

    verification_brief = ""
    if (cfg["has_followup_wave"] or cfg["is_iterative"]) and any(
        item["results"] for item in all_results
    ):
        yield f"data: {json.dumps({'type': 'status', 'text': 'Verifying evidence...'})}\n\n"
        brief_context = _search_results_excerpt(all_results, max_items_per_query=1)
        verification_system = (
            "You are a research verifier. Given the question and search results, summarize the most likely catalyst, "
            "supporting evidence, contradictory evidence, and unresolved gaps. Keep it concise but specific."
        )
        verification_user = (
            f"Question:\n{user_question}\n\n"
            f"Evidence ledger:\n{_evidence_ledger_excerpt(evidence_ledger, max_entries=8)}\n\n"
            f"Search results:\n{brief_context}"
        )
        try:
            verification_brief = _call_llm_sync(
                [{"role": "user", "content": verification_user}],
                model,
                provider,
                api_key,
                verification_system,
                llama_url,
            ).strip()
        except Exception:
            verification_brief = ""

    if provider == "llama":
        n_ctx = _get_llama_ctx_size(llama_url)
        # Reserve 35-40% for response; subtract ~300 tokens overhead for system + question
        ctx_ratio = 0.7 if cfg["is_iterative"] else 0.65 if cfg["has_followup_wave"] else 0.6
        max_ctx_tokens = int(n_ctx * ctx_ratio) - 300
        max_search_chars = max(500, max_ctx_tokens * 4)
        context = _trim_search_context(ctx_parts, max_search_chars)
    else:
        context = "".join(ctx_parts)

    has_results = any(item["results"] for item in all_results)
    if has_results:
        enriched_parts = []
        if verification_brief:
            enriched_parts.append(verification_brief)
        if evidence_ledger:
            enriched_parts.append(
                "[Evidence ledger]\n" + _evidence_ledger_excerpt(evidence_ledger, max_entries=12)
            )
        enriched_parts.append(context)
        enriched = (
            "\n\n---\n\n".join(enriched_parts)
            + f"\n\n---\n\nBased on the above research, provide a comprehensive answer to: {user_question}"
        )
    else:
        enriched = user_question

    synth_messages = conv_messages[:-1] + [{"role": "user", "content": enriched}]
    synthesis_system = cfg["synthesis_system"] + f"Today's date is {today}."
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


def _chat_toolchain() -> Toolchain:
    global _CHAT_TOOLCHAIN
    if _CHAT_TOOLCHAIN is None:
        _CHAT_TOOLCHAIN = Toolchain(
            search_assets=_search,
            get_ticker_info=_ticker_info,
            get_ticker_earnings=_ticker_earnings,
            get_ticker_dividends=_ticker_dividends,
            get_ticker_options=lambda ticker: _ticker_options(ticker, max_dte=30),
            get_etf_holdings=_etf_holdings,
            get_macro_data=_macro_data,
            get_markets=_markets,
            get_prediction_events=lambda: _kalshi_get_events(limit=50, force_refresh=False),
            get_ticker_financials=lambda ticker, view: _single(
                {
                    "ticker": ticker,
                    "view": view,
                    "quarterly": False,
                    "pivot": True,
                }
            ),
        )
    return _CHAT_TOOLCHAIN


def _prepare_chat_payload(payload: dict) -> dict:
    prepared = dict(payload)
    messages = list(payload.get("messages") or [])
    result = _chat_toolchain().augment_messages(messages)
    prepared["messages"] = result.messages
    prepared["tool_calls"] = result.tool_calls
    return prepared


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


def _chat_stream(payload: dict, provider: str):
    if provider == "llama":
        llama_url = payload.get("llamaUrl", "http://localhost:8080")
        payload["model"] = payload.get("model") or "local"
        return _stream_llama(payload, llama_url)
    if provider == "claude":
        return _stream_claude(payload)
    return _stream_openai(payload)


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
    output = [{"ticker": r[0], "name": r[1]} for r in results]
    if output:
        return output

    try:
        from yahoors.periphery.db import _init_tables as _init_yahoors_tables

        yconn = _init_yahoors_tables()
        rows = yconn.execute(
            """
            SELECT symbol, name, asset_type
            FROM company_info
            WHERE upper(symbol) LIKE ?
               OR upper(name) LIKE ?
            ORDER BY
                CASE
                    WHEN upper(symbol) = ? THEN 0
                    WHEN upper(symbol) LIKE ? THEN 1
                    WHEN upper(name) LIKE ? THEN 2
                    ELSE 3
                END,
                length(symbol),
                symbol
            LIMIT 12
            """,
            [f"{q}%", f"%{q}%", q, f"{q}%", f"%{q}%"],
        ).fetchall()
        for symbol, name, asset_type in rows:
            if asset_type and str(asset_type).upper() not in {"ETF", "EQUITY", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY"}:
                continue
            output.append({"ticker": symbol, "name": name})
    except Exception:
        pass

    return output


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
    elif view == "segments":
        df = get_revenue_by_segment(ticker_symbol, quarterly=quarterly)
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


def _download_candles_direct(
    ticker: str,
    interval: str,
    period: str,
    start: str | None = None,
    end: str | None = None,
) -> pl.DataFrame:
    params = {"interval": interval}
    if start:
        params["start"] = start
        params["end"] = end or dt.date.today().isoformat()
    else:
        params["period"] = period
    data = yf.download(ticker, progress=False, threads=False, **params)
    if data.empty:
        return pl.DataFrame()
    if isinstance(data.columns, pd.MultiIndex):
        data = data.stack(level=1, future_stack=True).reset_index()
    else:
        data = data.reset_index()
        if "Ticker" not in data.columns:
            data["Ticker"] = ticker
    data["Interval"] = interval
    df = pl.from_pandas(data)
    df = df.rename({c: c.lower() for c in df.columns})
    if "datetime" in df.columns and "date" not in df.columns:
        df = df.rename({"datetime": "date"})
    if "index" in df.columns and "date" not in df.columns:
        df = df.rename({"index": "date"})
    if "date" in df.columns:
        df = df.with_columns(
            pl.col("date").cast(pl.Utf8).str.to_datetime(strict=False, time_zone="UTC").alias("date")
        )
    df = df.drop_nulls(subset=["open", "high", "low", "close", "volume", "ticker"])
    target_cols = [
        "date",
        "ticker",
        "interval",
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]
    cols_to_select = [c for c in target_cols if c in df.columns]
    return df.select(cols_to_select)


def _int_query(qs: dict[str, list[str]], key: str) -> int | None:
    value = qs.get(key, [None])[0]
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _bool_query(qs: dict[str, list[str]], key: str) -> bool:
    value = str(qs.get(key, ["false"])[0]).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _candle_cache_key(
    ticker: str,
    period: str,
    interval: str,
    start: str | None,
) -> tuple[str, str, str, str | None]:
    return (ticker.strip().upper(), period.strip().lower(), interval.strip().lower(), start or None)


def _candle_cache_ttl(interval: str) -> float:
    return 600.0 if str(interval).lower() in _INTRADAY_INTERVALS else 1800.0


def _get_cached_candles(key: tuple[str, str, str, str | None]) -> pl.DataFrame | None:
    now = time.monotonic()
    with _CANDLE_CACHE_LOCK:
        cached = _CANDLE_BASE_CACHE.get(key)
        if not cached:
            return None
        expires_at, df = cached
        if expires_at <= now:
            _CANDLE_BASE_CACHE.pop(key, None)
            return None
        return df.clone()


def _set_cached_candles(key: tuple[str, str, str, str | None], df: pl.DataFrame, ttl: float) -> None:
    if df.is_empty():
        return
    with _CANDLE_CACHE_LOCK:
        _CANDLE_BASE_CACHE[key] = (time.monotonic() + ttl, df.clone())


def _run_live_socket_worker(ticker: str, csv_path: str, db_path: str):
    quote_path = Path(csv_path).with_suffix(".quote.json")
    sink = open(os.devnull, "w")
    try:
        def _write_quote(row: dict):
            try:
                payload = {
                    "ticker": row.get("ticker"),
                    "date": row.get("date"),
                    "price": row.get("close"),
                    "volume": row.get("volume"),
                }
                quote_path.write_text(json.dumps(payload), encoding="utf-8")
            except Exception:
                pass

        with redirect_stdout(sink), redirect_stderr(sink):
            socket = WebSocket(
                csv_path=csv_path,
                db_path=db_path,
                verbose=False,
                persist=True,
            )
            socket.stream([ticker], "1m", on_row=_write_quote)
    except Exception:
        pass
    finally:
        try:
            sink.close()
        except Exception:
            pass


def _candles(payload: dict) -> dict:
    from secrs.periphery.candles import Candles

    ticker = payload.get("ticker", "").strip().upper()
    interval = payload.get("interval", "1d")
    period = payload.get("period", "1y")
    if not ticker:
        raise ValueError("Enter a ticker.")

    indicators = bool(payload.get("indicators", False))
    force_refresh = bool(payload.get("force_refresh", False))
    cache_mode = str(payload.get("cache_mode", "normal")).strip().lower()
    start = _period_to_start(period)
    cache_key = _candle_cache_key(ticker, period, interval, start)
    # Pass the original period so the Candles subclass can detect and backfill
    # missing history; start= trims the result to the requested window.
    df = None if force_refresh else _get_cached_candles(cache_key)
    if df is None:
        if force_refresh:
            stale_threshold = dt.timedelta(seconds=0)
        elif cache_mode == "live":
            stale_threshold = dt.timedelta(days=3650)
        else:
            stale_threshold = None
        try:
            df = Candles().get_candles(
                [ticker],
                interval=interval,
                period=period,
                start=start,
                stale_threshold=stale_threshold,
            )
        except Exception:
            df = _download_candles_direct(ticker, interval, period, start=start)
        if df.is_empty() and str(interval).lower() in _INTRADAY_INTERVALS and period in {"1d", "5d"}:
            df = _download_candles_direct(ticker, interval, period)
        if not df.is_empty():
            _set_cached_candles(cache_key, df, _candle_cache_ttl(interval))
    if df.is_empty():
        return {"columns": [], "rows": [], "height": 0, "width": 0}

    df = df.clone()

    df = df.sort("date")
    df = df.select(["date", "ticker", "interval", "open", "high", "low", "close", "volume"])
    df = df.with_columns(
        pl.col("date")
        .cast(pl.Utf8)
        .str.to_datetime(strict=False, time_zone="UTC")
        .dt.strftime("%Y-%m-%d %H:%M:%S")
        .alias("date")
    )

    live_df = _live_candle_rows(ticker, interval)
    if not live_df.is_empty():
        live_df = live_df.select(["date", "ticker", "interval", "open", "high", "low", "close", "volume"])
        live_df = live_df.with_columns(
            pl.col("date")
            .cast(pl.Utf8)
            .str.to_datetime(strict=False, time_zone="UTC")
            .dt.strftime("%Y-%m-%d %H:%M:%S")
            .alias("date")
        )
        df = (
            pl.concat([df, live_df], how="vertical_relaxed")
            .unique(subset=["date", "ticker", "interval"], keep="last")
            .sort("date")
        )
    if indicators:
        from yahoors.periphery.technical_analysis import add_indicators

        df = add_indicators(df)
        drop_cols = [col for col in ("ticker", "interval") if col in df.columns]
        if drop_cols:
            df = df.drop(drop_cols)
    else:
        df = df.drop([col for col in ("ticker", "interval") if col in df.columns])
    df = df.sort("date")
    payload = _jsonable(df)
    live_quote = _live_quote(ticker)
    if live_quote:
        payload["live_quote"] = live_quote
    return payload


class _LiveCandleSession:
    def __init__(self, ticker: str):
        self.ticker = ticker
        self.csv_path = Path(tempfile.gettempdir()) / f"stocklens-live-{ticker.lower()}-{uuid4().hex}.csv"
        self.db_path = Path(tempfile.gettempdir()) / f"stocklens-live-{ticker.lower()}-{uuid4().hex}.duckdb"
        self.quote_path = self.csv_path.with_suffix(".quote.json")
        self.process: Process | None = None
        self.error: str | None = None
        self.started = False
        self.closed = False

    def start(self):
        if self.process and self.process.is_alive():
            return

        self.process = Process(
            target=_run_live_socket_worker,
            args=(self.ticker, str(self.csv_path), str(self.db_path)),
            daemon=True,
        )
        self.process.start()
        self.started = True

    def stop(self):
        try:
            if self.process and self.process.is_alive():
                self.process.terminate()
                self.process.join(timeout=2)
        finally:
            self.closed = True
            self._cleanup_csv()

    def live_frame(self, interval: str) -> pl.DataFrame:
        if not self.csv_path.exists() or self.csv_path.stat().st_size <= 0:
            return pl.DataFrame()
        try:
            from yahoors.modules.socket import WebSocket as _Socket

            return _Socket.read_csv(str(self.csv_path), interval)
        except Exception:
            return pl.DataFrame()

    def _cleanup_csv(self):
        try:
            self.csv_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            self.quote_path.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            self.db_path.unlink(missing_ok=True)
        except Exception:
            pass


def _live_candle_rows(ticker: str, interval: str) -> pl.DataFrame:
    if str(interval).lower() not in _INTRADAY_INTERVALS:
        return pl.DataFrame()
    session = _get_live_session(ticker)
    if session is None or session.error:
        return pl.DataFrame()
    return session.live_frame(interval)


def _live_quote(ticker: str) -> dict | None:
    session = _get_live_session(ticker)
    if session is None or not session.quote_path.exists():
        return None
    try:
        data = json.loads(session.quote_path.read_text(encoding="utf-8"))
        price = data.get("price")
        if price is None:
            return None
        return {
            "ticker": data.get("ticker") or ticker,
            "date": data.get("date"),
            "price": float(price),
            "volume": data.get("volume"),
        }
    except Exception:
        return None


def _get_live_session(ticker: str) -> _LiveCandleSession | None:
    with _LIVE_SESSION_LOCK:
        return _LIVE_SESSIONS.get(ticker)


def _start_live_session(ticker: str) -> dict:
    ticker = ticker.strip().upper()
    if not ticker:
        raise ValueError("ticker required")

    with _LIVE_SESSION_LOCK:
        existing = _LIVE_SESSIONS.get(ticker)
        if existing and not existing.closed:
            return {"ticker": ticker, "active": True, "status": "already-running"}

        # Only keep one live stream active at a time in this UI.
        for symbol, session in list(_LIVE_SESSIONS.items()):
            if symbol != ticker:
                session.stop()
                _LIVE_SESSIONS.pop(symbol, None)

        session = _LiveCandleSession(ticker)
        _LIVE_SESSIONS[ticker] = session

    try:
        session.start()
    except Exception:
        with _LIVE_SESSION_LOCK:
            _LIVE_SESSIONS.pop(ticker, None)
        session.stop()
        raise

    # Give immediate startup failures or a dead stream a moment to surface.
    time.sleep(2.0)
    csv_ready = session.csv_path.exists() and session.csv_path.stat().st_size > 0
    process_dead = session.process is not None and not session.process.is_alive()
    if session.error or (process_dead and not csv_ready):
        with _LIVE_SESSION_LOCK:
            _LIVE_SESSIONS.pop(ticker, None)
        session._cleanup_csv()
        return {
            "ticker": ticker,
            "active": True,
            "status": "polling",
            "mode": "poll",
            "warning": session.error or "Live stream closed; using candle polling.",
        }

    return {"ticker": ticker, "active": True, "status": "started", "mode": "socket"}


def _stop_live_session(ticker: str | None = None) -> dict:
    targets: list[tuple[str, _LiveCandleSession]]
    with _LIVE_SESSION_LOCK:
        if ticker:
            session = _LIVE_SESSIONS.pop(ticker.strip().upper(), None)
            targets = [((ticker.strip().upper()), session)] if session else []
        else:
            targets = list(_LIVE_SESSIONS.items())
            _LIVE_SESSIONS.clear()

    stopped = []
    for symbol, session in targets:
        if session is None:
            continue
        session.stop()
        stopped.append(symbol)
    return {"stopped": stopped, "active": False}


def _analyze_candles(payload: dict) -> dict:
    ticker = str(payload.get("ticker", "")).strip().upper()
    rows = payload.get("rows") or []
    period = str(payload.get("period", "")).strip()
    interval = str(payload.get("interval", "")).strip()
    provider = str(payload.get("provider", "llama")).strip().lower() or "llama"
    llama_url = str(payload.get("llamaUrl", "http://localhost:8080")).strip() or "http://localhost:8080"
    asset_type = str(payload.get("assetType", "stock")).strip().upper() or "STOCK"

    if not ticker:
        raise ValueError("Enter a ticker.")
    if not rows:
        raise ValueError("No candle rows provided.")

    candles = _normalize_analysis_rows(rows)
    if len(candles) < 5:
        return {
            "title": f"{ticker} Analysis",
            "patterns": [],
            "rectangles": [],
            "response": "Not enough candle history to analyze.",
            "queries": [],
            "window": {"period": period, "interval": interval, "rows": len(candles)},
        }

    patterns = _detect_candle_patterns(candles, ticker, asset_type)
    rectangles = [
        {
            "startIndex": pattern["startIndex"],
            "endIndex": pattern["endIndex"],
            "label": pattern["title"],
        }
        for pattern in patterns
    ]

    if not patterns:
        response = (
            f"No strong price/volume pattern stood out in the selected {period or 'current'} "
            f"window for {ticker}."
        )
        return {
            "title": f"{ticker} Analysis",
            "patterns": [],
            "rectangles": [],
            "response": response,
            "queries": [],
            "window": {"period": period, "interval": interval, "rows": len(candles)},
        }

    query_results = []
    for pattern in patterns[:3]:
        query = (
            f'{ticker} catalyst news around {pattern["startDate"]} to {pattern["endDate"]} '
            f'earnings guidance press release SEC analyst upgrade downgrade'
        )
        try:
          results = _web_search(query, max_results=4)
        except Exception:
            results = []
        query_results.append(
            {
                "query": query,
                "results": results,
                "pattern": pattern["title"],
                "dateRange": f'{pattern["startDate"]} to {pattern["endDate"]}',
            }
        )

    today = dt.datetime.now().strftime("%B %d, %Y")
    context_parts = [
        f"[Today's date: {today}]",
        f"[Ticker: {ticker}]",
        f"[Asset type: {asset_type}]",
        f"[Chart window: {period or 'current'} / {interval or '1d'}]",
        "",
        "[Detected patterns]",
    ]
    for i, pattern in enumerate(patterns, 1):
        context_parts.append(
            f"{i}. {pattern['title']}\n"
            f"   Range: {pattern['startDate']} to {pattern['endDate']}\n"
            f"   Details: {pattern['details']}\n"
            f"   Score: {pattern['score']:.2f}"
        )
    context_parts.append("")
    for item in query_results:
        context_parts.append(
            f'[Likely catalyst search for {item["pattern"]} ({item["dateRange"]})]'
        )
        if not item["results"]:
            context_parts.append("   No results found.")
            continue
        for j, result in enumerate(item["results"], 1):
            context_parts.append(
                f"{j}. {result['title']}\n   {result['snippet']}\n   {result['url']}"
            )

    prompt = "\n".join(context_parts) + (
        "\n\nWrite a concise but useful explanation of what most likely caused each move. "
        "Focus on catalysts, company-specific news, earnings, guidance, press releases, SEC filings, "
        "analyst changes, or macro headlines that line up with the date ranges. "
        "If the evidence is weak, say the move is unattributed or only tentatively linked. "
        "Reference the date ranges explicitly."
    )

    system = (
        "You are a market analyst. Use the detected price/volume patterns and web search results "
        "to identify the most likely catalysts behind each move. Be specific, cautious, and concise. "
        "Do not claim causality unless the evidence supports it."
    )
    api_key = ""
    if provider == "claude":
        api_key = os.environ.get("SECRS_CLAUDE_API_KEY", "")
    elif provider == "openai":
        api_key = os.environ.get("SECRS_OPENAI_API_KEY", "")
    response = _call_llm_sync(
        [{"role": "user", "content": prompt}],
        model="local" if provider == "llama" else ("claude-sonnet-4-6" if provider == "claude" else "gpt-4o"),
        provider=provider,
        api_key=api_key,
        system=system,
        llama_url=llama_url,
    )

    return {
        "title": f"{ticker} Analysis",
        "patterns": patterns,
        "rectangles": rectangles,
        "response": response,
        "queries": query_results,
        "window": {"period": period, "interval": interval, "rows": len(candles)},
    }


def _live_start(payload: dict) -> dict:
    ticker = str(payload.get("ticker", "")).strip().upper()
    return _start_live_session(ticker)


def _live_stop(payload: dict) -> dict:
    ticker = str(payload.get("ticker", "")).strip().upper()
    return _stop_live_session(ticker or None)


def _normalize_analysis_rows(rows: list[dict]) -> list[dict]:
    def _parse_date(value):
        if value is None:
            return dt.datetime.min
        try:
            return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return dt.datetime.min

    normalized = []
    for index, row in enumerate(rows):
        normalized.append({
            "index": index,
            "date": str(row.get("date") or row.get("timestamp") or "").strip(),
            "open": _safe_float(row.get("open")),
            "high": _safe_float(row.get("high")),
            "low": _safe_float(row.get("low")),
            "close": _safe_float(row.get("close")),
            "volume": _safe_float(row.get("volume")),
            "_sort": _parse_date(row.get("date") or row.get("timestamp")),
        })
    normalized = [row for row in normalized if row["date"] and row["close"] is not None]
    normalized.sort(key=lambda row: row["_sort"])
    for row in normalized:
        row.pop("_sort", None)
    return normalized


def _safe_float(value):
    try:
        if value in (None, ""):
            return None
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    except Exception:
        return None


def _detect_candle_patterns(rows: list[dict], ticker: str, asset_type: str) -> list[dict]:
    spans = []
    prefix = "ETF" if asset_type == "ETF" else "stock"
    price_move_threshold = 0.05
    gap_threshold = 0.04
    volume_spike_multiplier = 3.0
    breakout_threshold = 1.03
    breakdown_threshold = 0.97

    def _avg(values):
        vals = [v for v in values if v is not None]
        return (sum(vals) / len(vals)) if vals else None

    def _title_for_labels(labels: list[str]) -> str:
        ordered = []
        for label in labels:
            if label and label not in ordered:
                ordered.append(label)
        if not ordered:
            return "Pattern"
        if len(ordered) == 1:
            return ordered[0]
        return " / ".join(ordered)

    for i in range(1, len(rows)):
        cur = rows[i]
        prev = rows[i - 1]
        reasons = []
        labels = []
        score = 0.0

        prev_close = prev.get("close")
        cur_close = cur.get("close")
        if prev_close and cur_close:
            pct_change = (cur_close - prev_close) / prev_close
            if abs(pct_change) >= price_move_threshold:
                reasons.append(f"{pct_change * 100:+.1f}% price move")
                labels.append("Price Move")
                score += abs(pct_change) * 10
            if pct_change >= gap_threshold and cur.get("open") is not None and cur["open"] > prev_close * (1 + gap_threshold):
                reasons.append("gap up + strong close")
                labels.append("Gap Up")
                score += 0.8
            if pct_change <= -gap_threshold and cur.get("open") is not None and cur["open"] < prev_close * (1 - gap_threshold):
                reasons.append("gap down + weak close")
                labels.append("Gap Down")
                score += 0.8

        start = max(0, i - 20)
        prior_vol_avg = _avg([rows[j].get("volume") for j in range(start, i)])
        if prior_vol_avg and cur.get("volume") is not None and cur["volume"] >= prior_vol_avg * volume_spike_multiplier:
            ratio = cur["volume"] / prior_vol_avg
            reasons.append(f"volume spike ({ratio:.1f}x 20-day avg)")
            labels.append("Volume Spike")
            score += min(ratio / 4, 3)

        prior_high = _avg([rows[j].get("high") for j in range(start, i)])
        prior_low = _avg([rows[j].get("low") for j in range(start, i)])
        if prior_high and cur_close and cur_close >= prior_high * breakout_threshold:
            reasons.append("breakout above recent highs")
            labels.append("Breakout")
            score += 1.2
        if prior_low and cur_close and cur_close <= prior_low * breakdown_threshold:
            reasons.append("breakdown below recent lows")
            labels.append("Breakdown")
            score += 1.2

        if reasons:
            title_labels = labels or ["Price Move"]
            title = _title_for_labels(title_labels)
            spans.append({
              "startIndex": max(0, i - 1),
              "endIndex": min(len(rows) - 1, i + 1),
              "title": title,
              "labels": title_labels,
              "type": title_labels[0].lower().replace(" ", "_"),
              "details": ", ".join(dict.fromkeys(reasons)),
              "startDate": rows[max(0, i - 1)]["date"],
              "endDate": rows[min(len(rows) - 1, i + 1)]["date"],
              "score": score,
              "query": f"{ticker} {prefix} pattern {rows[max(0, i - 1)]['date']} {rows[min(len(rows) - 1, i + 1)]['date']} news",
          })

    return _merge_analysis_spans(spans)


def _merge_analysis_spans(spans: list[dict]) -> list[dict]:
    if not spans:
        return []
    spans = sorted(spans, key=lambda item: (item["startIndex"], item["endIndex"]))
    merged = [spans[0].copy()]
    for span in spans[1:]:
        cur = merged[-1]
        if span["startIndex"] <= cur["endIndex"] + 1:
            cur["endIndex"] = max(cur["endIndex"], span["endIndex"])
            cur["startIndex"] = min(cur["startIndex"], span["startIndex"])
            cur["startDate"] = min(cur["startDate"], span["startDate"])
            cur["endDate"] = max(cur["endDate"], span["endDate"])
            cur["score"] = max(cur["score"], span["score"])
            cur_labels = cur.setdefault("labels", [])
            for label in span.get("labels", []):
                if label not in cur_labels:
                    cur_labels.append(label)
            cur["title"] = " / ".join(cur_labels) if cur_labels else cur.get("title", "Pattern")
            if span["details"] not in cur["details"]:
                cur["details"] = f"{cur['details']}; {span['details']}"
        else:
            merged.append(span.copy())
    return merged


def _ticker_info(ticker: str, refresh: bool = False) -> dict:
    from yahoors import Ticker as YTicker

    obj = YTicker(ticker)
    df = obj.force_update() if refresh else obj.info
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


def _insider_trades(ticker: str) -> dict:
    tracker = InsiderTracker()
    df = tracker.ticker.get_insider_trades(ticker)
    df = df.with_columns([
        pl.col("filing_date").dt.strftime("%Y-%m-%d").alias("filing_date"),
        pl.col("trade_date").cast(pl.Utf8).alias("trade_date"),
    ])
    return {"rows": df.to_dicts()}


def _ticker_earnings(ticker: str) -> dict:
    """Return earnings dates, history, and estimates for a single ticker."""
    from yahoors.modules.earnings import Earnings

    earnings = Earnings()
    dates_df = earnings.get_earnings_dates([ticker])
    history_df = earnings.get_earnings_history([ticker])
    estimates_df = earnings.get_earnings_estimates([ticker])

    return {
        "title": f"{ticker} Earnings",
        "dates": _jsonable(dates_df),
        "history": _jsonable(history_df),
        "estimates": _jsonable(estimates_df),
    }


def _ticker_dividends(ticker: str) -> dict:
    from yahoors.modules.dividends import Dividends

    dividends = Dividends()
    df = dividends.get_dividends([ticker])
    if df is None:
        df = pl.DataFrame()
    if not df.is_empty() and "date" in df.columns:
        df = df.sort("date", descending=True)
    return {"title": f"{ticker} Dividends", **_jsonable(df)}


def _crypto_token(query: str) -> GeckoToken:
    normalized = str(query or "").strip()
    if not normalized:
        raise ValueError("Crypto ticker required.")
    if "-" in normalized:
        normalized = normalized.split("-", 1)[0]
    token = GeckoToken(normalized)
    if not getattr(token, "exists", False):
        raise ValueError(f"Crypto token not found for '{query}'.")
    return token


def _crypto_info(ticker: str, refresh: bool = False) -> dict:
    token = _crypto_token(ticker)
    if refresh:
        token.refresh(include_supply=True)
    description = token.description
    links = token.links or {}
    if isinstance(description, dict):
        description = description.get("en") or next(
            (value for value in description.values() if value),
            "",
        )
    description = str(description or "").strip()
    updated_at = getattr(token, "data", {}).get("last_updated") or getattr(token, "data", {}).get("fetched_at")
    resolved_links = []
    if isinstance(links, dict):
        homepage = links.get("homepage")
        if isinstance(homepage, list):
            homepage = next((item for item in homepage if item), None)
        if homepage:
            resolved_links.append({"label": "Website", "url": str(homepage)})

        for key, label in (
            ("blockchain_site", "Explorer"),
            ("official_forum_url", "Forum"),
            ("chat_url", "Chat"),
            ("announcement_url", "Announcements"),
            ("twitter_screen_name", "X"),
            ("subreddit_url", "Reddit"),
            ("repos_url", "GitHub"),
        ):
            value = links.get(key)
            if isinstance(value, dict):
                value = value.get("github") or next((item for item in value.values() if item), None)
            if isinstance(value, list):
                value = next((item for item in value if item), None)
            if not value:
                continue
            if key == "twitter_screen_name":
                value = f"https://x.com/{str(value).lstrip('@')}"
            resolved_links.append({"label": label, "url": str(value)})

    deduped_links = []
    seen_urls = set()
    for item in resolved_links:
        url = item["url"].strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduped_links.append(item)

    return {
        "symbol": str(token.symbol or ticker).upper(),
        "name": token.name or ticker,
        "id": token.id,
        "circulating_supply": token.circulating_supply,
        "max_supply": token.max_supply,
        "description": description,
        "updated_at": updated_at,
        "links": deduped_links[:5],
    }


def _crypto_addresses(ticker: str) -> dict:
    token = _crypto_token(ticker)
    contracts = token.contract_addresses or {}
    rows = []
    if isinstance(contracts, dict):
        for chain, address in contracts.items():
            if address:
                rows.append(
                    {
                        "chain": str(chain),
                        "address": str(address),
                    }
                )
    return {
        "title": f"{token.name or ticker} Addresses",
        "symbol": str(token.symbol or ticker).upper(),
        "name": token.name or ticker,
        "rows": rows,
    }


def _chunked(values: list, size: int):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _batch_yahoors_info(symbols: list[str], batch_size: int = 50) -> pd.DataFrame:
    from yahoors import Ticker as YTicker

    rows: list[dict] = []
    for batch in _chunked(symbols, batch_size):
        try:
            info = YTicker(batch).info
        except Exception:
            continue
        if info is None or info.is_empty():
            continue
        rows.extend(info.to_dicts())

    if not rows:
        return pd.DataFrame(columns=["symbol", "name", "sector", "asset_type"])

    info_df = pd.DataFrame(rows)
    if "symbol" not in info_df.columns:
        return pd.DataFrame(columns=["symbol", "name", "sector", "asset_type"])
    info_df["symbol"] = info_df["symbol"].astype(str).str.upper()
    keep_cols = [col for col in ["symbol", "name", "sector", "asset_type"] if col in info_df.columns]
    return info_df.loc[:, keep_cols].drop_duplicates(subset=["symbol"], keep="first")


def _etf_holdings(ticker: str) -> dict:
    from etftracker.etftracker import get_etf_holdings

    holdings = get_etf_holdings(ticker, headless=True)
    if holdings is None or holdings.empty:
        return {
            "title": f"{ticker} Holdings",
            "data": {"columns": [], "rows": [], "height": 0, "width": 0},
            "sector_breakdown": [],
            "summary": {"holdings_count": 0, "sector_count": 0},
        }

    frame = holdings.copy()
    frame["symbol"] = frame["symbol"].astype(str).str.upper().str.strip()
    frame["weight_pct"] = pd.to_numeric(frame.get("weight_pct"), errors="coerce").fillna(0.0)
    frame["name"] = frame["name"].astype(str).str.strip()

    info_df = _batch_yahoors_info(frame["symbol"].dropna().astype(str).unique().tolist())
    if not info_df.empty:
        renamed = info_df.rename(columns={"name": "info_name", "sector": "info_sector"})
        frame = frame.merge(renamed, on="symbol", how="left")
        if "info_name" in frame.columns:
            frame["name"] = frame["info_name"].fillna(frame["name"])
        if "info_sector" in frame.columns:
            frame["sector"] = frame["info_sector"]
    else:
        frame["sector"] = None

    frame["sector"] = frame["sector"].fillna("Unknown").replace("", "Unknown")
    frame = frame.drop_duplicates(subset=["symbol"], keep="first").reset_index(drop=True)
    frame = frame.sort_values("weight_pct", ascending=False).reset_index(drop=True)

    sector_breakdown = (
        frame.groupby("sector", dropna=False, as_index=False)["weight_pct"]
        .sum()
        .sort_values("weight_pct", ascending=False)
        .reset_index(drop=True)
    )

    display_columns = [
        "symbol",
        "name",
        "sector",
        "weight_pct",
        "shares_owned",
        "shares_value",
    ]
    display = frame.loc[:, [column for column in display_columns if column in frame.columns]].copy()

    return {
        "title": f"{ticker} Holdings",
        "data": _jsonable(display),
        "sector_breakdown": _jsonable(sector_breakdown),
        "summary": {
            "holdings_count": int(len(frame)),
            "sector_count": int(len(sector_breakdown)),
        },
    }


def _macro_tracker():
    global _MACRO_TRACKER
    if _MACRO_TRACKER is None:
        from macrotracker import MacroTracker

        _MACRO_TRACKER = MacroTracker()
    return _MACRO_TRACKER


_MACRO_TABS = {
    "gdp": {
        "label": "GDP",
        "method": "get_gdp",
        "title": "GDP",
        "chart_columns": ["real_gdp", "nominal_gdp"],
        "primary_column": "real_gdp",
    },
    "cpi": {
        "label": "CPI",
        "method": "get_cpi",
        "kwargs": {"include_inflation": True},
        "title": "CPI",
        "chart_columns": ["inflation_yoy_pct"],
        "primary_column": "inflation_yoy_pct",
    },
    "pce": {
        "label": "PCE",
        "method": "get_pce",
        "kwargs": {"include_inflation": True},
        "title": "PCE",
        "chart_columns": ["pce_inflation_yoy_pct", "core_pce_inflation_yoy_pct"],
        "primary_column": "pce_inflation_yoy_pct",
    },
    "labor": {
        "label": "Labor",
        "method": "get_labor_market",
        "title": "Labor",
        "chart_columns": ["initial_claims"],
        "primary_column": "initial_claims",
    },
    "unemployment": {
        "label": "Unemployment",
        "method": "get_unemployment_rate",
        "title": "Unemployment",
        "chart_columns": ["value"],
        "primary_column": "value",
    },
    "treasury": {
        "label": "Treasury",
        "method": "get_treasury_rates",
        "title": "Treasury",
        "chart_columns": ["treasury_10y", "treasury_2y", "yield_curve_10y2y"],
        "primary_column": "treasury_10y",
    },
    "fed_funds": {
        "label": "Fed Funds",
        "method": "get_fed_funds_rate",
        "title": "Fed Funds",
        "chart_columns": ["value"],
        "primary_column": "value",
    },
    "credit": {
        "label": "Credit",
        "method": "get_credit_conditions",
        "title": "Credit",
        "chart_columns": ["baa_corporate_yield", "baa_10y_spread", "high_yield_spread", "financial_stress_index"],
        "primary_column": "baa_10y_spread",
    },
    "liquidity": {
        "label": "Liquidity",
        "method": "get_liquidity_conditions",
        "title": "Liquidity",
        "chart_columns": ["m2"],
        "primary_column": "m2",
    },
    "housing": {
        "label": "Housing",
        "method": "get_housing_conditions",
        "title": "Housing",
        "chart_columns": ["housing_starts"],
        "primary_column": "housing_starts",
    },
    "consumer": {
        "label": "Consumer",
        "method": "get_consumer_conditions",
        "title": "Consumer",
        "chart_columns": ["consumer_sentiment"],
        "primary_column": "consumer_sentiment",
    },
}


def _macro_data(tab: str) -> dict:
    cfg = _MACRO_TABS.get(tab)
    if not cfg:
        raise ValueError(f"Unknown macro tab: {tab}")
    tracker = _macro_tracker()
    method = getattr(tracker, cfg["method"])
    df = method(**cfg.get("kwargs", {}))
    if df is None:
        df = pl.DataFrame()
    target_columns = [col for col in cfg["chart_columns"] if col in df.columns]
    if target_columns:
        df = df.filter(
            pl.any_horizontal([pl.col(col).is_not_null() for col in target_columns])
        )
    if not df.is_empty() and "observation_date" in df.columns:
        df = df.sort("observation_date", descending=True)
    return {
        "title": cfg["title"],
        "tab": tab,
        "data": _jsonable(df),
        "primary_column": cfg["primary_column"],
        "chart_columns": cfg["chart_columns"],
        "x_column": "observation_date",
    }


def _ticker_options(ticker: str, max_dte: int | None = 30) -> dict:
    return _options_chain([ticker], max_dte=max_dte)


def _ticker_expirations_within_dte(ticker: str, max_dte: int | None) -> list[str]:
    import yfinance as yf

    if max_dte is None:
        return []

    today = dt.date.today()
    expirations = []
    for exp in yf.Ticker(ticker).options:
        try:
            exp_date = dt.date.fromisoformat(exp)
        except ValueError:
            continue
        dte = (exp_date - today).days
        if 0 <= dte <= max_dte:
            expirations.append(exp)
    return expirations


def _fetch_options_chain_df(
    tickers: list[str], max_dte: int | None = 30
) -> tuple[pl.DataFrame, list[str], list[str]]:
    from yahoors.modules.options import Options

    if not tickers:
        raise ValueError("Enter at least one ticker.")

    options = Options()
    frames: list[pl.DataFrame] = []
    skipped: list[str] = []
    errors: list[str] = []
    for ticker in tickers:
        try:
            expirations = _ticker_expirations_within_dte(ticker, max_dte)
            if max_dte is not None and not expirations:
                skipped.append(ticker)
                errors.append(f"{ticker}: no expirations found within {max_dte} DTE")
                continue
            frame = options.get_options([ticker], expirations=expirations)
            if frame is None or frame.is_empty():
                skipped.append(ticker)
                continue
            if max_dte is not None and "dte" in frame.columns:
                frame = frame.filter((pl.col("dte") >= 0) & (pl.col("dte") <= max_dte))
                if frame.is_empty():
                    skipped.append(ticker)
                    errors.append(f"{ticker}: no contracts returned within {max_dte} DTE")
                    continue
            frames.append(frame)
        except Exception as exc:
            skipped.append(ticker)
            errors.append(f"{ticker}: {exc}")

    if not frames:
        empty = pl.DataFrame(schema={
            "ticker": pl.Utf8,
            "expiration": pl.Date,
            "option_type": pl.Utf8,
            "strike": pl.Float64,
            "last_price": pl.Float64,
        })
        return empty, skipped, errors

    df = pl.concat(frames, how="diagonal_relaxed")
    return df, skipped, errors


def _normalize_options_df(df: pl.DataFrame) -> pl.DataFrame:
    if "last_price" in df.columns:
        df = df.with_columns((pl.col("last_price") * 100).alias("contract_premium"))
    if {"option_type", "strike", "stock_price"}.issubset(set(df.columns)):
        df = df.with_columns(
            pl.when(pl.col("option_type") == "put")
            .then(pl.col("strike") * 100)
            .when(pl.col("option_type") == "call")
            .then(pl.col("stock_price") * 100)
            .otherwise(None)
            .alias("collateral_required")
        )
    if "last_price" in df.columns and "bs_price" in df.columns:
        df = df.with_columns(
            (pl.col("last_price") - pl.col("bs_price")).alias("bs_spread")
        )
    if {"contract_premium", "collateral_required"}.issubset(set(df.columns)):
        df = df.with_columns(
            pl.when(pl.col("collateral_required") > 0)
            .then(pl.col("contract_premium") / pl.col("collateral_required"))
            .otherwise(None)
            .alias("premium_yield")
        )
    if {"premium_yield", "prob_profit"}.issubset(set(df.columns)):
        df = df.with_columns(
            (pl.col("premium_yield") * pl.col("prob_profit")).alias("pop_adjusted_yield")
        )
    if {"pop_adjusted_yield", "dte"}.issubset(set(df.columns)):
        df = df.with_columns(
            pl.when(pl.col("dte") > 0)
            .then(pl.col("pop_adjusted_yield") * (pl.lit(365.0) / pl.col("dte")))
            .otherwise(None)
            .alias("annualized_pop_adjusted_yield")
        )
    return df


def _options_chain(tickers: list[str], max_dte: int | None = 30) -> dict:
    df, skipped, errors = _fetch_options_chain_df(tickers, max_dte=max_dte)
    df = _normalize_options_df(df)
    columns = [
        "ticker",
        "expiration",
        "option_type",
        "strike",
        "last_price",
        "contract_premium",
        "collateral_required",
        "premium_yield",
        "pop_adjusted_yield",
        "annualized_pop_adjusted_yield",
        "bs_price",
        "bs_spread",
        "bid",
        "ask",
        "volume",
        "open_interest",
        "implied_volatility",
        "in_the_money",
        "dte",
        "delta",
        "gamma",
        "theta",
        "vega",
        "prob_profit",
        "hist_prob_profit",
    ]
    available = [column for column in columns if column in df.columns]
    if not available:
        payload = _jsonable(df)
        if skipped:
            payload["warning"] = f"Skipped {len(skipped)} ticker(s): {', '.join(skipped)}"
        if errors:
            payload["details"] = errors[:10]
        return payload
    df = df.select(available)
    if "expiration" in df.columns:
        df = df.with_columns(pl.col("expiration").cast(pl.Utf8))
    if "option_type" in df.columns:
        df = df.with_columns(pl.col("option_type").cast(pl.Utf8))
    for column in [
        "strike",
        "last_price",
        "contract_premium",
        "collateral_required",
        "premium_yield",
        "pop_adjusted_yield",
        "annualized_pop_adjusted_yield",
        "bs_price",
        "bs_spread",
        "bid",
        "ask",
        "implied_volatility",
        "delta",
        "gamma",
        "theta",
        "vega",
        "prob_profit",
        "hist_prob_profit",
    ]:
        if column in df.columns:
            df = df.with_columns(pl.col(column).round(4))
    sort_columns = [column for column in ["expiration", "option_type", "strike"] if column in df.columns]
    if sort_columns:
        df = df.sort(sort_columns)
    payload = _jsonable(df)
    if skipped:
        payload["warning"] = f"Skipped {len(skipped)} ticker(s): {', '.join(skipped)}"
    if errors:
        payload["details"] = errors[:10]
    return payload


def _option_screener(payload: dict) -> dict:
    from yahoors.modules.screener import options_screener

    tickers = _tickers(payload.get("tickers"))
    raw_max_dte = payload.get("max_dte", 30)
    max_dte = None if str(raw_max_dte).lower() == "all" else int(raw_max_dte)
    long = bool(payload.get("long", False))
    in_the_money = bool(payload.get("in_the_money", False))
    min_collateral = float(payload.get("min_collateral") or 0.0)
    raw_max_collateral = payload.get("max_collateral")
    max_collateral = (
        float(raw_max_collateral)
        if raw_max_collateral not in (None, "", "null")
        else float("inf")
    )
    df, skipped, errors = _fetch_options_chain_df(tickers, max_dte=max_dte)
    screened = options_screener(
        df,
        min_dte=0,
        max_dte=max_dte if max_dte is not None else 365,
        in_the_money=in_the_money,
        long=long,
        min_collateral=min_collateral,
        max_collateral=max_collateral,
    )
    screened = _normalize_options_df(screened)
    result = {
        "title": "Option Screener",
        "data": _jsonable(screened),
    }
    if skipped:
        result["warning"] = f"Skipped {len(skipped)} ticker(s): {', '.join(skipped)}"
    if errors:
        result["details"] = errors[:10]
    return result


def _insider_cluster_buys() -> dict:
    tracker = InsiderTracker()
    df = tracker.cluster_buys.get_cluster_buys()
    df = df.with_columns([
        pl.col("filing_date").dt.strftime("%Y-%m-%d").alias("filing_date"),
        pl.col("trade_date").cast(pl.Utf8).alias("trade_date"),
        pl.col("value").round(0).cast(pl.Int64).alias("value"),
        pl.col("price").round(2).alias("price"),
        pl.col("quantity").cast(pl.Int64).alias("quantity"),
        pl.col("owned").cast(pl.Int64).alias("owned"),
    ])
    col_labels = {
        "filing_date": "Filed",
        "trade_date": "Trade Date",
        "ticker": "Symbol",
        "company_name": "Company",
        "industry": "Industry",
        "num_insiders": "# Insiders",
        "trade_type": "Type",
        "price": "Price",
        "quantity": "Qty",
        "owned": "Owned",
        "ownership_change": "Chg %",
        "value": "Value",
    }
    columns = [col_labels.get(c, c) for c in df.columns]
    rows = [
        {col_labels.get(k, k): v for k, v in row.items()}
        for row in df.to_dicts()
    ]
    return {
        "title": "Insider Cluster Buys",
        "data": {"columns": columns, "rows": rows},
        "cache": None,
    }


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
_MACRO_TRACKER = None
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
    "/api/option-screener": _option_screener,
    "/api/dcf": _dcf,
    "/api/watchlist/csv": _watchlist_csv,
    "/api/candles": _candles,
    "/api/analyze-candles": _analyze_candles,
    "/api/live/start": _live_start,
    "/api/live/stop": _live_stop,
}


class UIHandler(BaseHTTPRequestHandler):
    server_version = "secrs-ui/0.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query, keep_blank_values=True)
        if path == "/api/options":
            self._send_json(_options())
            return
        if path == "/api/search":
            q = qs.get("q", [""])[0]
            self._send_json(_search(q))
            return
        if path == "/api/kalshi/events":
            try:
                payload = _kalshi_get_events(
                    cursor=qs.get("cursor", [None])[0] or None,
                    limit=_int_query(qs, "limit"),
                    status=qs.get("status", [None])[0] or None,
                    series_ticker=qs.get("series_ticker", [None])[0] or None,
                    min_close_ts=_int_query(qs, "min_close_ts"),
                    min_updated_ts=_int_query(qs, "min_updated_ts"),
                    with_nested_markets=_bool_query(qs, "with_nested_markets"),
                    with_milestones=_bool_query(qs, "with_milestones"),
                    force_refresh=_bool_query(qs, "force_refresh"),
                )
                self._send_json(payload)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/event":
            ticker = qs.get("event_ticker", [""])[0].strip()
            if not ticker:
                self._send_json({"error": "event_ticker required"}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(
                    _kalshi_get_event(
                        ticker,
                        with_nested_markets=_bool_query(qs, "with_nested_markets"),
                        force_refresh=_bool_query(qs, "force_refresh"),
                    )
                )
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/markets":
            try:
                payload = _kalshi_get_markets(
                    cursor=qs.get("cursor", [None])[0] or None,
                    limit=_int_query(qs, "limit"),
                    event_ticker=qs.get("event_ticker", [None])[0] or None,
                    series_ticker=qs.get("series_ticker", [None])[0] or None,
                    max_close_ts=_int_query(qs, "max_close_ts"),
                    min_close_ts=_int_query(qs, "min_close_ts"),
                    status=qs.get("status", [None])[0] or None,
                    tickers=qs.get("tickers", [None])[0] or None,
                    min_updated_ts=_int_query(qs, "min_updated_ts"),
                    force_refresh=_bool_query(qs, "force_refresh"),
                )
                self._send_json(payload)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/market":
            ticker = qs.get("ticker", [""])[0].strip()
            if not ticker:
                self._send_json({"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(
                    _kalshi_get_market(
                        ticker,
                        force_refresh=_bool_query(qs, "force_refresh"),
                    )
                )
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/orderbook":
            ticker = qs.get("ticker", [""])[0].strip()
            if not ticker:
                self._send_json({"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(
                    _kalshi_get_market_orderbook(
                        ticker,
                        depth=_int_query(qs, "depth"),
                        force_refresh=_bool_query(qs, "force_refresh"),
                    )
                )
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/series":
            ticker = qs.get("series_ticker", [""])[0].strip()
            if not ticker:
                self._send_json({"error": "series_ticker required"}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(
                    _kalshi_get_series(
                        ticker,
                        force_refresh=_bool_query(qs, "force_refresh"),
                    )
                )
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/candlesticks":
            series_ticker = qs.get("series_ticker", [""])[0].strip()
            ticker = qs.get("ticker", [""])[0].strip()
            if not series_ticker or not ticker:
                self._send_json(
                    {"error": "series_ticker and ticker required"},
                    status=HTTPStatus.BAD_REQUEST,
                )
                return
            start_ts = _int_query(qs, "start_ts")
            end_ts = _int_query(qs, "end_ts")
            if start_ts is None or end_ts is None:
                self._send_json(
                    {"error": "start_ts and end_ts required"},
                    status=HTTPStatus.BAD_REQUEST,
                )
                return
            try:
                self._send_json(
                    _kalshi_get_market_candlesticks(
                        series_ticker,
                        ticker,
                        start_ts=start_ts,
                        end_ts=end_ts,
                        period_interval=_int_query(qs, "period_interval") or 60,
                        include_latest_before_start=_bool_query(qs, "include_latest_before_start"),
                        force_refresh=_bool_query(qs, "force_refresh"),
                    )
                )
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/kalshi/cache":
            self._send_json(_kalshi_cache_stats())
            return
        if path == "/api/ticker-info":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                refresh = _bool_query(qs, "refresh")
                self._send_json(_ticker_info(ticker, refresh=refresh))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/crypto-info":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                refresh = _bool_query(qs, "refresh")
                self._send_json(_crypto_info(ticker, refresh=refresh))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/crypto-addresses":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_crypto_addresses(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/insider-trades":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_insider_trades(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/earnings":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json({"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST)
                return
            try:
                self._send_json(_ticker_earnings(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/ticker-dividends":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_ticker_dividends(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/etf-holdings":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_etf_holdings(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/ticker-options":
            ticker = qs.get("ticker", [""])[0].strip().upper()
            raw_max_dte = parse_qs(parsed.query).get("max_dte", ["30"])[0]
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                max_dte = None if str(raw_max_dte).lower() == "all" else int(raw_max_dte)
                self._send_json(_ticker_options(ticker, max_dte=max_dte))
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
            q = qs.get("q", [""])[0].strip()
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
        if path == "/api/macro":
            tab = parse_qs(parsed.query).get("tab", ["gdp"])[0].strip().lower()
            try:
                self._send_json(_macro_data(tab))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/markets":
            sub = parse_qs(parsed.query).get("sub", ["most_active"])[0]
            try:
                if sub == "insider_cluster_buys":
                    self._send_json(_insider_cluster_buys())
                elif sub == "macro":
                    tab = parse_qs(parsed.query).get("tab", ["gdp"])[0].strip().lower()
                    self._send_json(_macro_data(tab))
                else:
                    self._send_json(_markets(sub))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if path in PAGE_ROUTES or path.startswith("/ticker/") or path.startswith("/etf/") or path.startswith("/crypto/"):
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
        module_path = (MODULES_DIR / path.removeprefix("/modules/")).resolve()
        if path.startswith("/modules/") and module_path.is_relative_to(MODULES_DIR):
            if module_path.is_file():
                content_type = (
                    mimetypes.guess_type(module_path)[0] or "application/octet-stream"
                )
                self._send_file(module_path, content_type)
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
        if path in ("/api/chat/claude", "/api/chat/openai", "/api/chat/llama"):
            payload = _prepare_chat_payload(self._read_json())
            provider = (
                "claude"
                if path.endswith("claude")
                else "openai"
                if path.endswith("openai")
                else "llama"
            )
            if provider in {"claude", "openai"}:
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
                gen = _chat_stream(payload, provider)
                extra_headers = None
                tool_calls = payload.get("tool_calls") or []
                if tool_calls:
                    extra_headers = {
                        "x-stocklens-tool-calls": json.dumps(tool_calls),
                    }
                self._send_sse_stream(gen, extra_headers=extra_headers)
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

    def _send_sse_stream(self, gen, extra_headers: dict[str, str] | None = None):
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache")
        self.send_header("x-accel-buffering", "no")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
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
