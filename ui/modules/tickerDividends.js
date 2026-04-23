import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { escapeHtml } from "/modules/utils.js";

export async function runTickerDividends() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-dividends-body");
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/ticker-dividends?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderTickerDividends(data, body);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderTickerDividends(payload, body) {
  const rows = payload.rows || [];
  if (rows.length === 0) {
    body.innerHTML = `<div class="ticker-info-empty">No dividends data found.</div>`;
    return;
  }

  const columns = payload.columns || Object.keys(rows[0] || {});
  const displayColumns = columns.includes("ticker") && new Set(rows.map((row) => row.ticker)).size <= 1
    ? columns.filter((column) => column !== "ticker")
    : columns;
  const thead = `<thead><tr>${displayColumns.map((c) => `<th>${escapeHtml(labelize(c))}</th>`).join("")}</tr></thead>`;

  const sorted = [...rows].sort((a, b) => {
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return db - da;
  });

  const latest = sorted[0] || {};
  const events = sorted.length;
  const latestDividend = latest.dividend != null ? formatMoney(latest.dividend) : "—";
  const latestYield = latest.dividend_yield_pct != null ? `${formatNumber(latest.dividend_yield_pct)}%` : "—";
  const latestClose = latest.close != null ? formatMoney(latest.close) : "—";

  const rowsHtml = sorted.map((row) => {
    const cells = displayColumns.map((column) => `<td>${escapeHtml(formatCell(column, row[column]))}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  body.innerHTML = `
    <div class="earnings-summary dividends-summary">
      <span class="earnings-summary-item">Events ${events}</span>
      <span class="earnings-summary-item">Latest Dividend ${latestDividend}</span>
      <span class="earnings-summary-item">Latest Yield ${latestYield}</span>
      <span class="earnings-summary-item">Close ${latestClose}</span>
    </div>
    <div class="ticker-earnings-table">
      <table class="result-table">${thead}<tbody>${rowsHtml}</tbody></table>
    </div>`;
}

function formatCell(column, value) {
  if (value == null) return "—";
  if (value instanceof Date) return value.toLocaleString("en-US");
  if (typeof value === "number") {
    if (column === "dividend_yield_pct") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && /(date|time)/i.test(String(column))) {
    return date.toLocaleString("en-US");
  }
  return String(value);
}

function formatMoney(value) {
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function labelize(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
