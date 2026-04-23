from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable


MARKETS_SUB_ALIASES = {
    "most active": "most_active",
    "gainers": "gainers",
    "losers": "losers",
    "trending": "trending",
    "unusual volume": "unusual_volume",
    "small cap": "small_cap",
    "ipo": "ipo",
    "private companies": "private_companies",
    "insider cluster buys": "insider_cluster_buys",
}

MACRO_TAB_ALIASES = {
    "gdp": "gdp",
    "cpi": "cpi",
    "pce": "pce",
    "labor": "labor",
    "jobs": "labor",
    "unemployment": "unemployment",
    "treasury": "treasury",
    "yields": "treasury",
    "fed funds": "fed_funds",
    "fed": "fed_funds",
    "credit": "credit",
    "liquidity": "liquidity",
    "housing": "housing",
    "consumer": "consumer",
}

PREDICTION_CATEGORY_ALIASES = {
    "sports": "sports",
    "crypto": "crypto",
    "politics": "politics",
    "economics": "economics",
    "weather": "weather",
    "technology": "technology",
    "tech": "technology",
    "energy": "energy",
    "entertainment": "entertainment",
}

FINANCIAL_VIEW_KEYWORDS = {
    "income statement": "income_statement",
    "balance sheet": "balance_sheet",
    "cash flow": "cash_flow",
    "segments": "segments",
    "regions": "regions",
    "financials": "income_statement",
}

TICKER_TOKEN_RE = re.compile(r"@tickers/([A-Za-z0-9.\-_,]+)")
USER_CONTEXT_SPLIT_RE = re.compile(r"\n\s*---\s*\n")
UPPER_TICKER_RE = re.compile(r"\b[A-Z][A-Z0-9.\-]{0,5}\b")


@dataclass
class ToolchainResult:
    messages: list[dict]
    tool_calls: list[str]
    context_blocks: list[str]


class Toolchain:
    def __init__(
        self,
        *,
        search_assets: Callable[[str], list[dict]],
        get_ticker_info: Callable[[str], dict],
        get_ticker_earnings: Callable[[str], dict],
        get_ticker_dividends: Callable[[str], dict],
        get_ticker_options: Callable[[str], dict],
        get_etf_holdings: Callable[[str], dict],
        get_macro_data: Callable[[str], dict],
        get_markets: Callable[[str], dict],
        get_prediction_events: Callable[[], dict],
        get_ticker_financials: Callable[[str, str], dict],
    ):
        self.search_assets = search_assets
        self.get_ticker_info = get_ticker_info
        self.get_ticker_earnings = get_ticker_earnings
        self.get_ticker_dividends = get_ticker_dividends
        self.get_ticker_options = get_ticker_options
        self.get_etf_holdings = get_etf_holdings
        self.get_macro_data = get_macro_data
        self.get_markets = get_markets
        self.get_prediction_events = get_prediction_events
        self.get_ticker_financials = get_ticker_financials

    def augment_messages(self, messages: list[dict]) -> ToolchainResult:
        if not messages:
            return ToolchainResult(messages=list(messages), tool_calls=[], context_blocks=[])

        user_indexes = [i for i, message in enumerate(messages) if message.get("role") == "user"]
        if not user_indexes:
            return ToolchainResult(messages=list(messages), tool_calls=[], context_blocks=[])

        last_user_index = user_indexes[-1]
        original = str(messages[last_user_index].get("content", "") or "").strip()
        if not original or "[Local tool context]" in original:
            return ToolchainResult(messages=list(messages), tool_calls=[], context_blocks=[])

        question = self._extract_user_question(original)
        if not question:
            return ToolchainResult(messages=list(messages), tool_calls=[], context_blocks=[])

        blocks: list[str] = []
        tool_calls: list[str] = []

        tickers = self._resolve_tickers(question)
        for ticker in tickers[:2]:
            info = self._safe_call(self.get_ticker_info, ticker)
            if not info:
                continue
            blocks.append(self._summarize_ticker_info(ticker, info))
            tool_calls.append(f"get_ticker_info({ticker})")
            asset_type = str(info.get("asset_type") or "").upper()

            financial_view = self._infer_financial_view(question)
            if financial_view:
                payload = self._safe_call(self.get_ticker_financials, ticker, financial_view)
                summary = self._summarize_financials(ticker, financial_view, payload)
                if summary:
                    blocks.append(summary)
                    tool_calls.append(f"get_ticker_financials({ticker}, {financial_view})")

            if any(keyword in question.lower() for keyword in ("earnings", "eps", "estimate", "beat", "miss")):
                payload = self._safe_call(self.get_ticker_earnings, ticker)
                summary = self._summarize_earnings(ticker, payload)
                if summary:
                    blocks.append(summary)
                    tool_calls.append(f"get_ticker_earnings({ticker})")

            if any(keyword in question.lower() for keyword in ("dividend", "yield", "payout")):
                payload = self._safe_call(self.get_ticker_dividends, ticker)
                summary = self._summarize_dividends(ticker, payload)
                if summary:
                    blocks.append(summary)
                    tool_calls.append(f"get_ticker_dividends({ticker})")

            if any(keyword in question.lower() for keyword in ("option", "call", "put", "dte", "iv", "premium", "strike")):
                payload = self._safe_call(self.get_ticker_options, ticker)
                summary = self._summarize_options(ticker, payload)
                if summary:
                    blocks.append(summary)
                    tool_calls.append(f"get_ticker_options({ticker})")

            if asset_type == "ETF" and any(
                keyword in question.lower() for keyword in ("holding", "exposure", "sector", "weight", "constituent")
            ):
                payload = self._safe_call(self.get_etf_holdings, ticker)
                summary = self._summarize_etf_holdings(ticker, payload)
                if summary:
                    blocks.append(summary)
                    tool_calls.append(f"get_etf_holdings({ticker})")

        macro_tab = self._infer_macro_tab(question)
        if macro_tab:
            payload = self._safe_call(self.get_macro_data, macro_tab)
            summary = self._summarize_macro(macro_tab, payload)
            if summary:
                blocks.append(summary)
                tool_calls.append(f"get_macro_data({macro_tab})")

        markets_sub = self._infer_markets_sub(question)
        if markets_sub:
            payload = self._safe_call(self.get_markets, markets_sub)
            summary = self._summarize_markets(markets_sub, payload)
            if summary:
                blocks.append(summary)
                tool_calls.append(f"get_markets({markets_sub})")

        prediction_category = self._infer_prediction_category(question)
        if prediction_category:
            payload = self._safe_call(self.get_prediction_events)
            summary = self._summarize_prediction_markets(prediction_category, payload)
            if summary:
                blocks.append(summary)
                tool_calls.append(f"get_prediction_events({prediction_category})")

        if not blocks:
            return ToolchainResult(messages=list(messages), tool_calls=[], context_blocks=[])

        augmented = list(messages)
        augmented[last_user_index] = {
            **messages[last_user_index],
            "content": self._format_context_block(blocks) + "\n\n---\n\n" + original,
        }
        return ToolchainResult(messages=augmented, tool_calls=tool_calls, context_blocks=blocks)

    def _extract_user_question(self, content: str) -> str:
        parts = [part.strip() for part in USER_CONTEXT_SPLIT_RE.split(content) if part.strip()]
        return parts[-1] if parts else content.strip()

    def _resolve_tickers(self, text: str) -> list[str]:
        explicit = []
        for match in TICKER_TOKEN_RE.finditer(text):
            explicit.extend(
                [token.strip().upper() for token in match.group(1).split(",") if token.strip()]
            )
        if explicit:
            return self._dedupe(explicit)

        candidates = self._dedupe(UPPER_TICKER_RE.findall(text))
        resolved = []
        for token in candidates[:8]:
            try:
                results = self.search_assets(token)
            except Exception:
                continue
            exact = next(
                (
                    item.get("ticker", "").upper()
                    for item in results
                    if str(item.get("ticker", "")).upper() == token
                ),
                None,
            )
            if exact:
                resolved.append(exact)
        return self._dedupe(resolved)

    def _infer_macro_tab(self, text: str) -> str | None:
        lowered = text.lower()
        if "macro" not in lowered and not any(alias in lowered for alias in MACRO_TAB_ALIASES):
            return None
        for alias, tab in MACRO_TAB_ALIASES.items():
            if alias in lowered:
                return tab
        return "gdp"

    def _infer_markets_sub(self, text: str) -> str | None:
        lowered = text.lower()
        if "market" not in lowered and "stocks" not in lowered and "movers" not in lowered:
            return None
        for alias, sub in MARKETS_SUB_ALIASES.items():
            if alias in lowered:
                return sub
        return None

    def _infer_prediction_category(self, text: str) -> str | None:
        lowered = text.lower()
        if "prediction market" not in lowered and "kalshi" not in lowered:
            return None
        for alias, category in PREDICTION_CATEGORY_ALIASES.items():
            if alias in lowered:
                return category
        return "all"

    def _infer_financial_view(self, text: str) -> str | None:
        lowered = text.lower()
        for alias, view in FINANCIAL_VIEW_KEYWORDS.items():
            if alias in lowered:
                return view
        return None

    def _format_context_block(self, blocks: list[str]) -> str:
        return "[Local tool context]\n" + "\n\n".join(blocks)

    def _summarize_ticker_info(self, ticker: str, info: dict) -> str:
        lines = [f"[Ticker overview: {ticker}]"]
        name = info.get("name")
        asset_type = info.get("asset_type")
        sector = info.get("sector")
        industry = info.get("industry")
        price = info.get("last_price") or info.get("regular_market_price") or info.get("previous_close")
        market_cap = info.get("market_cap")
        pe = info.get("trailing_pe") or info.get("forward_pe")
        lines.append(
            f"Name: {name or ticker} | Asset type: {asset_type or 'Unknown'}"
        )
        meta = []
        if sector:
            meta.append(f"Sector: {sector}")
        if industry:
            meta.append(f"Industry: {industry}")
        if price is not None:
            meta.append(f"Price: {self._fmt_number(price)}")
        if market_cap is not None:
            meta.append(f"Market cap: {self._fmt_large_number(market_cap)}")
        if pe is not None:
            meta.append(f"PE: {self._fmt_number(pe)}")
        if meta:
            lines.append(" | ".join(meta))
        summary = str(info.get("business_summary") or "").strip()
        if summary:
            lines.append("Summary: " + self._truncate(summary, 320))
        return "\n".join(lines)

    def _summarize_financials(self, ticker: str, view: str, payload: dict | None) -> str | None:
        data = (payload or {}).get("data") or {}
        rows = data.get("rows") or []
        columns = data.get("columns") or []
        if not rows or not columns:
            return None
        date_columns = [col for col in columns if col not in {"label", "ticker", "symbol", "ratio_label"}]
        recent_cols = date_columns[:2]
        lines = [f"[Ticker financials: {ticker} {view}]"]
        for row in rows[:6]:
            label = row.get("label") or row.get("ratio_label") or row.get("ticker") or "Row"
            metrics = []
            for col in recent_cols:
                if row.get(col) is not None:
                    metrics.append(f"{col}: {self._fmt_number(row.get(col))}")
            if metrics:
                lines.append(f"{label} | " + " | ".join(metrics))
        return "\n".join(lines)

    def _summarize_earnings(self, ticker: str, payload: dict | None) -> str | None:
        history = ((payload or {}).get("history") or {}).get("rows") or []
        if not history:
            return None
        lines = [f"[Ticker earnings: {ticker}]"]
        beats = 0
        misses = 0
        for row in history[:4]:
            reported = self._to_float(row.get("reported_eps"))
            estimate = self._to_float(row.get("eps_estimate"))
            if reported is not None and estimate is not None:
                if reported > estimate:
                    beats += 1
                elif reported < estimate:
                    misses += 1
            period = row.get("date") or row.get("quarter") or row.get("earnings_date") or "Unknown"
            lines.append(
                f"{period}: reported EPS {self._fmt_number(reported)} vs estimate {self._fmt_number(estimate)}"
            )
        lines.append(f"Recent beat/miss count: beats={beats}, misses={misses}")
        return "\n".join(lines)

    def _summarize_dividends(self, ticker: str, payload: dict | None) -> str | None:
        rows = (payload or {}).get("rows") or []
        if not rows:
            return None
        latest = rows[0]
        lines = [f"[Ticker dividends: {ticker}]"]
        lines.append(
            f"Latest: {latest.get('date', 'Unknown')} | dividend={self._fmt_number(latest.get('dividend'))} | "
            f"ttm={self._fmt_number(latest.get('ttm_dividend'))} | yield={self._fmt_pct(latest.get('dividend_yield_pct'))}"
        )
        return "\n".join(lines)

    def _summarize_options(self, ticker: str, payload: dict | None) -> str | None:
        rows = ((payload or {}).get("data") or {}).get("rows") or []
        if not rows:
            return None
        lines = [f"[Ticker options: {ticker}]"]
        lines.append(f"Contracts available: {len(rows)}")
        best = sorted(
            rows,
            key=lambda row: self._to_float(row.get("annualized_pop_adjusted_yield")) or -1.0,
            reverse=True,
        )[:3]
        for row in best:
            lines.append(
                f"{row.get('option_type', '?')} {row.get('strike', '?')} exp {row.get('expiration', '?')} | "
                f"DTE={row.get('dte', '?')} | premium={self._fmt_number(row.get('last_price'))} | "
                f"annualized POP-adjusted yield={self._fmt_pct(row.get('annualized_pop_adjusted_yield'))}"
            )
        return "\n".join(lines)

    def _summarize_etf_holdings(self, ticker: str, payload: dict | None) -> str | None:
        summary = (payload or {}).get("summary") or {}
        rows = (((payload or {}).get("data") or {}).get("rows")) or []
        sectors = (payload or {}).get("sector_breakdown") or []
        if not rows:
            return None
        lines = [f"[ETF holdings: {ticker}]"]
        lines.append(
            f"Holdings count: {summary.get('holdings_count', len(rows))} | "
            f"Sectors: {summary.get('sector_count', len(sectors))}"
        )
        lines.append(
            "Top holdings: "
            + ", ".join(
                f"{row.get('symbol', '?')} {self._fmt_pct(row.get('weight_pct'), scale=100.0)}"
                for row in rows[:5]
            )
        )
        if sectors:
            lines.append(
                "Top sectors: "
                + ", ".join(
                    f"{row.get('sector', 'Unknown')} {self._fmt_pct(row.get('weight_pct'), scale=100.0)}"
                    for row in sectors[:4]
                )
            )
        return "\n".join(lines)

    def _summarize_macro(self, tab: str, payload: dict | None) -> str | None:
        data = (payload or {}).get("data") or {}
        rows = data.get("rows") or []
        if not rows:
            return None
        columns = [col for col in (payload or {}).get("chart_columns", []) if col in rows[0]]
        lines = [f"[Macro: {tab}]"]
        for row in rows[:3]:
            date = row.get("observation_date") or row.get("date") or "Unknown"
            metrics = []
            for col in columns[:3]:
                if row.get(col) is not None:
                    metrics.append(f"{col}={self._fmt_number(row.get(col))}")
            if metrics:
                lines.append(f"{date} | " + " | ".join(metrics))
        return "\n".join(lines)

    def _summarize_markets(self, sub: str, payload: dict | None) -> str | None:
        rows = (payload or {}).get("rows") or []
        if not rows:
            rows = ((payload or {}).get("data") or {}).get("rows") or []
        if not rows:
            return None
        lines = [f"[Markets: {sub}]"]
        for row in rows[:5]:
            symbol = row.get("symbol") or row.get("ticker") or row.get("name") or "Unknown"
            price = row.get("price") or row.get("last_price") or row.get("last")
            change_pct = row.get("change_pct") or row.get("percent_change") or row.get("change_percent")
            volume = row.get("volume") or row.get("avg_volume")
            parts = [symbol]
            if price is not None:
                parts.append(f"price={self._fmt_number(price)}")
            if change_pct is not None:
                parts.append(f"change={self._fmt_pct(change_pct, scale=1.0)}")
            if volume is not None:
                parts.append(f"volume={self._fmt_large_number(volume)}")
            lines.append(" | ".join(parts))
        return "\n".join(lines)

    def _summarize_prediction_markets(self, category: str, payload: dict | None) -> str | None:
        events = (payload or {}).get("events") or []
        if not events:
            return None
        filtered = []
        for event in events:
            if category == "all" or self._prediction_event_matches(category, event):
                filtered.append(event)
            if len(filtered) >= 5:
                break
        if not filtered:
            return None
        lines = [f"[Prediction markets: {category}]"]
        for event in filtered:
            title = event.get("title") or event.get("event_ticker") or "Unknown"
            subtitle = event.get("sub_title") or ""
            close_ts = event.get("close_ts") or event.get("settlement_time") or ""
            text = title
            if subtitle:
                text += f" | {self._truncate(subtitle, 80)}"
            if close_ts:
                text += f" | close={close_ts}"
            lines.append(text)
        return "\n".join(lines)

    def _prediction_event_matches(self, category: str, event: dict) -> bool:
        haystack = " ".join(
            str(event.get(key) or "")
            for key in ("category", "title", "sub_title", "event_ticker", "series_ticker")
        ).lower()
        if category == "all":
            return True
        return category.lower() in haystack

    def _safe_call(self, fn: Callable, *args):
        try:
            return fn(*args)
        except Exception:
            return None

    def _dedupe(self, values: list[str]) -> list[str]:
        seen = set()
        output = []
        for value in values:
            key = value.strip().upper()
            if not key or key in seen:
                continue
            seen.add(key)
            output.append(key)
        return output

    def _truncate(self, text: str, limit: int) -> str:
        return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."

    def _to_float(self, value):
        try:
            if value in (None, ""):
                return None
            return float(value)
        except Exception:
            return None

    def _fmt_number(self, value) -> str:
        num = self._to_float(value)
        if num is None:
            return "n/a"
        if abs(num) >= 1000:
            return f"{num:,.0f}"
        if abs(num) >= 100:
            return f"{num:,.2f}"
        return f"{num:,.3f}".rstrip("0").rstrip(".")

    def _fmt_large_number(self, value) -> str:
        num = self._to_float(value)
        if num is None:
            return "n/a"
        abs_num = abs(num)
        if abs_num >= 1_000_000_000_000:
            return f"{num / 1_000_000_000_000:.2f}T"
        if abs_num >= 1_000_000_000:
            return f"{num / 1_000_000_000:.2f}B"
        if abs_num >= 1_000_000:
            return f"{num / 1_000_000:.2f}M"
        if abs_num >= 1_000:
            return f"{num / 1_000:.2f}K"
        return self._fmt_number(num)

    def _fmt_pct(self, value, scale: float = 100.0) -> str:
        num = self._to_float(value)
        if num is None:
            return "n/a"
        return f"{num * scale:.2f}%"
