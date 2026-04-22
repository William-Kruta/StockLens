import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { setStatus } from "/modules/data.js";
import { escapeHtml } from "/modules/utils.js";

export function renderOptionScreenerWatchlists() {
  const select = $("#option-screener-watchlist");
  if (!select) return;

  if (state.watchlists.length === 0) {
    select.innerHTML = `<option value="">No watchlists available</option>`;
    return;
  }

  select.innerHTML = `
    <option value="">Select watchlist</option>
    ${state.watchlists.map((watchlist) => `<option value="${escapeHtml(watchlist.id)}">${escapeHtml(watchlist.name)}</option>`).join("")}
  `;
}

export function bindOptionScreener() {
  $("#option-screener-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = $("#option-screener-body");
    const watchlistId = $("#option-screener-watchlist")?.value || "";
    const maxDte = $("#option-screener-fetch-dte")?.value || "30";
    const long = ($("#option-screener-side")?.value || "false") === "true";
    const inTheMoney = ($("#option-screener-moneyness")?.value || "false") === "true";
    const minCollateral = Number($("#option-screener-min-collateral")?.value || "0");
    const rawMaxCollateral = $("#option-screener-max-collateral")?.value || "";
    const watchlist = state.watchlists.find((item) => item.id === watchlistId);
    if (!watchlist) {
      setStatus("Select a watchlist.", true);
      return;
    }
    body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
    try {
      const response = await fetch("/api/option-screener", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tickers: watchlist.tickers || [],
          max_dte: maxDte,
          long,
          in_the_money: inTheMoney,
          min_collateral: Number.isFinite(minCollateral) ? minCollateral : 0,
          max_collateral: rawMaxCollateral.trim() ? Number(rawMaxCollateral) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
      renderOptionScreenerTable(body, data.data);
      const warning = data.warning ? ` ${data.warning}` : "";
      setStatus(`${(watchlist.tickers || []).length} tickers screened for options.${warning}`, false);
    } catch (error) {
      body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(error.message)}</div>`;
      setStatus(error.message, true);
    }
  });
}

function renderOptionScreenerTable(body, data) {
  const columns = data?.columns || [];
  const rows = data?.rows || [];
  if (!columns.length || !rows.length) {
    body.innerHTML = `<div class="ticker-info-empty">No screened contracts found.</div>`;
    return;
  }

  const head = columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("");
  const bodyRows = rows.map((row) => {
    const cells = columns.map((column) => `<td>${escapeHtml(formatCell(column, row[column]))}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  body.innerHTML = `
    <div class="insider-filter-bar">
      <div class="insider-summary">
        <span class="insider-summary-item"><span class="insider-summary-label">Contracts</span><span class="insider-summary-value">${rows.length}</span></span>
      </div>
    </div>
    <div class="insider-table-wrap">
      <table class="insider-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function formatCell(column, value) {
  if (value === null || value === undefined) return "—";
  const percentColumns = new Set([
    "implied_volatility",
    "prob_profit",
    "hist_prob_profit",
    "premium_yield",
    "pop_adjusted_yield",
    "annualized_pop_adjusted_yield",
    "roc",
    "annualized_roc",
    "expected_return",
  ]);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (percentColumns.has(column) && typeof value === "number") return `${(value * 100).toFixed(2)}%`;
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return String(value);
}

function labelize(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
