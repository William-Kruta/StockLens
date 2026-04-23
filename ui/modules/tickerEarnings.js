import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { escapeHtml } from "/modules/utils.js";

export async function runTickerEarnings() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-earnings-body");
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderEarnings(data, body);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderEarnings(payload, body) {
  const dates = payload.dates?.rows || [];
  if (!dates || dates.length === 0) {
    body.innerHTML = `<div class="ticker-info-empty">No earnings data found.</div>`;
    return;
  }

  const baseCols = payload.dates?.columns || Object.keys(dates[0] || {});
  const cols = [...baseCols, "result"];
  const settled = dates.filter((row) => row.reported_eps != null && row.eps_estimate != null);
  const beats = settled.filter((row) => Number(row.reported_eps) > Number(row.eps_estimate)).length;
  const misses = settled.filter((row) => Number(row.reported_eps) <= Number(row.eps_estimate)).length;

  const thead = `<thead><tr>${cols.map((c) => `<th>${escapeHtml(labelize(c))}</th>`).join("")}</tr></thead>`;
  const rows = dates.map((r) => {
    const result = classifyEarningsResult(r);
    const cells = cols.map((c) => {
      if (c === "result") {
        if (!result) return `<td>—</td>`;
        return `<td><span class="earnings-badge ${result === "Beat" ? "beat" : "miss"}">${escapeHtml(result)}</span></td>`;
      }
      return `<td>${escapeHtml(formatCell(c, r[c]))}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  body.innerHTML = `
    <div class="earnings-summary">
      <span class="earnings-summary-item earnings-summary-beat">Beats ${beats}/${settled.length}</span>
      <span class="earnings-summary-item earnings-summary-miss">Misses ${misses}/${settled.length}</span>
    </div>
    <div class="ticker-earnings-table">
      <table class="result-table">${thead}<tbody>${rows}</tbody></table>
    </div>`;
}

function classifyEarningsResult(row) {
  if (row.reported_eps == null || row.eps_estimate == null) return null;
  return Number(row.reported_eps) > Number(row.eps_estimate) ? "Beat" : "Missed";
}

function formatCell(column, value) {
  if (value == null) return "—";
  if (value instanceof Date) return value.toLocaleString("en-US");
  if (typeof value === "number") {
    const isPercent = String(column).toLowerCase().includes("surprise");
    if (isPercent) return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && /(date|quarter)/i.test(String(column))) {
    return date.toLocaleString("en-US");
  }
  return String(value);
}

function labelize(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
