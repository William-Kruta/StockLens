import { escapeHtml } from "/modules/utils.js";

export function renderOptionsTable(container, data) {
  let columns = data?.columns || [];
  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const rows = (data?.rows || []).filter((row) => {
    const dte = Number(row?.dte);
    const expiration = String(row?.expiration || "");
    return Number.isFinite(dte) && dte >= 0 && expiration >= todayStr;
  });

  if (!columns.length || !rows.length) {
    container.innerHTML = `<div class="ticker-info-empty">No options data found.</div>`;
    return;
  }

  if (columns.includes("ticker")) {
    const tickers = new Set(rows.map((row) => row.ticker));
    if (tickers.size <= 1) columns = columns.filter((column) => column !== "ticker");
  }

  const percentColumns = new Set([
    "implied_volatility",
    "prob_profit",
    "hist_prob_profit",
    "premium_yield",
    "pop_adjusted_yield",
    "annualized_pop_adjusted_yield",
  ]);
  const head = columns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("");
  const uniqueDtes = [...new Set(
    rows.map((row) => Number(row?.dte)).filter((dte) => Number.isFinite(dte) && dte >= 0)
  )].sort((a, b) => a - b);

  container.innerHTML = `
    <div class="insider-filter-bar">
      <label class="insider-filter-label">Type
        <select class="options-type-filter">
          <option value="all">All</option>
          <option value="calls">Calls</option>
          <option value="puts">Puts</option>
        </select>
      </label>
      <label class="insider-filter-label">DTE
        <select class="options-dte-filter">
          <option value="all">All</option>
          ${uniqueDtes.map((dte) => `<option value="${dte}">${dte}</option>`).join("")}
        </select>
      </label>
      <div class="insider-summary">
        <span class="insider-summary-item"><span class="insider-summary-label">Contracts</span><span class="insider-summary-value options-contract-count">${rows.length}</span></span>
      </div>
    </div>
    <div class="insider-table-wrap">
      <table class="insider-table">
        <thead><tr>${head}</tr></thead>
        <tbody class="options-tbody"></tbody>
      </table>
    </div>`;

  const typeSelect = container.querySelector(".options-type-filter");
  const dteSelect = container.querySelector(".options-dte-filter");
  const tbody = container.querySelector(".options-tbody");
  const count = container.querySelector(".options-contract-count");

  function buildRows(subset) {
    return subset.map((row) => {
      const cells = columns.map((column) => `<td>${escapeHtml(formatOptionCell(column, row[column], percentColumns))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
  }

  function applyFilters() {
    const typeValue = typeSelect.value;
    const dteValue = dteSelect.value;
    const filtered = rows.filter((row) => {
      const optionType = String(row?.option_type || "").toLowerCase();
      const dte = Number(row?.dte);
      if (!Number.isFinite(dte) || dte < 0) return false;
      if (typeValue === "calls" && optionType !== "call") return false;
      if (typeValue === "puts" && optionType !== "put") return false;
      if (dteValue !== "all" && dte > Number(dteValue)) return false;
      return true;
    });
    tbody.innerHTML = buildRows(filtered);
    count.textContent = String(filtered.length);
  }

  typeSelect.addEventListener("change", applyFilters);
  dteSelect.addEventListener("change", applyFilters);
  applyFilters();
}

function formatOptionCell(column, value, percentColumns) {
  if (value === null || value === undefined) return "—";
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
