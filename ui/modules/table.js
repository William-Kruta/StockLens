import { $ } from "/modules/dom.js";
import { setStatus } from "/modules/data.js";

export function renderTable(data) {
  const table = $("#result-table");
  table.innerHTML = "";
  if (!data || !data.columns || !data.rows || data.rows.length === 0) {
    setStatus("No rows returned.", false);
    return;
  }

  let columns = data.columns;
  if (columns.includes("ticker")) {
    const values = new Set(data.rows.map((row) => row["ticker"]));
    if (values.size <= 1) columns = columns.filter((c) => c !== "ticker");
  }

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  data.rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = formatTableCell(column, row[column]);
      applyDirectionalCellClass(td, column, row[column]);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  $("#result-meta").textContent = `${data.height} rows · ${data.width} columns`;
  setStatus("Done.", false);
}

export function renderSummary(summary) {
  const target = $("#summary");
  target.innerHTML = "";
  if (!summary) return;

  const metrics = [
    ["Ticker", summary.ticker],
    ["Intrinsic / share", summary.intrinsic_value_per_share],
    ["Enterprise value", summary.enterprise_value],
    ["Base FCF", summary.base_fcf],
    ["Growth rate", rate(summary.assumptions?.stage1_growth_rate)],
    ["Discount rate", rate(summary.assumptions?.discount_rate)],
    ["Terminal growth", rate(summary.assumptions?.terminal_growth_rate)],
    ["Warnings", summary.warnings?.length || 0],
  ];

  metrics.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "metric";
    item.innerHTML = `<span>${label}</span><strong>${formatValue(value)}</strong>`;
    target.appendChild(item);
  });
}

export function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatTableCell(column, value) {
  if (String(column).trim().toLowerCase() === "symbol") {
    return cleanMarketSymbol(value);
  }
  if (String(column).trim().toLowerCase() === "price") {
    return stripInlinePriceChange(value);
  }
  return formatValue(value);
}

export function cleanMarketSymbol(value) {
  const formatted = formatValue(value).trim();
  const parts = formatted.split(/\s+/);
  if (parts.length >= 2 && parts[0].length === 1) return parts[1];
  return parts[0] || "";
}

function stripInlinePriceChange(value) {
  const formatted = formatValue(value);
  const match = formatted.match(/^\s*([+-]?\d[\d,]*(?:\.\d+)?)/);
  return match ? match[1] : formatted;
}

function applyDirectionalCellClass(td, column, value) {
  if (!isDirectionalColumn(column)) return;
  const numeric = parseSignedNumber(value);
  if (numeric === null || numeric === 0) return;
  td.classList.add(numeric > 0 ? "value-positive" : "value-negative");
}

function isDirectionalColumn(column) {
  return /^change\b/i.test(String(column).trim());
}

export function parseSignedNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const match = String(value).replace(/,/g, "").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function rate(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : value;
}
