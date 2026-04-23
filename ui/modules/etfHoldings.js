import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { escapeHtml } from "/modules/utils.js";
import { formatValue } from "/modules/table.js";
import { setStatus } from "/modules/data.js";

const PALETTE = [
  "#C8FF00",
  "#4FC3F7",
  "#FFB800",
  "#00E5A0",
  "#FF8A65",
  "#B388FF",
  "#FF4B4B",
  "#7CFFCB",
  "#FF9F1C",
  "#63C5DA",
];

export async function runEtfHoldings() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-holdings-body");
  if (!body) return;

  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  setStatus("Loading…", false);
  try {
    const data = await getEtfHoldingsData(ticker);
    renderEtfHoldings(data, body);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
    setStatus(err.message, true);
  }
}

async function getEtfHoldingsData(ticker) {
  const cached = state.etfHoldingsCache?.get(ticker);
  if (cached) return cached.data;

  const response = await fetch(`/api/etf-holdings?ticker=${encodeURIComponent(ticker)}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  if (!state.etfHoldingsCache) state.etfHoldingsCache = new Map();
  state.etfHoldingsCache.set(ticker, { fetchedAt: Date.now(), data });
  return data;
}

function renderEtfHoldings(payload, body) {
  const rows = payload?.data?.rows || [];
  const columns = payload?.data?.columns || [];
  const sectorBreakdown = payload?.sector_breakdown || [];

  if (!rows.length) {
    body.innerHTML = `<div class="ticker-info-empty">No holdings data found.</div>`;
    return;
  }

  const displayColumns = [
    "symbol",
    "name",
    "sector",
    "weight_pct",
    "shares_owned",
    "shares_value",
  ].filter((column) => columns.includes(column));

  const uniqueRows = dedupeRows(rows);
  const sortedRows = [...uniqueRows].sort((a, b) => {
    const aw = Number(a?.weight_pct) || 0;
    const bw = Number(b?.weight_pct) || 0;
    return bw - aw;
  });
  const sectors = normalizeSectors(sectorBreakdown, sortedRows);
  const tickerWeights = normalizeTickerWeights(sortedRows, 10);
  const summary = payload?.summary || {};

  body.innerHTML = `
    <div class="etf-holdings-shell">
      <div class="etf-holdings-panel">
        <div class="etf-holdings-panel-head">
          <div>
            <p class="eyebrow">Sector Exposure</p>
            <h2>${escapeHtml(payload.title || "ETF Holdings")}</h2>
          </div>
          <span>${escapeHtml(summary.holdings_count ? `${summary.holdings_count} holdings` : `${uniqueRows.length} holdings`)}</span>
        </div>
        <div class="etf-holdings-summary" id="etf-holdings-summary"></div>
        <div class="etf-holdings-chart-grid">
          <div class="etf-holdings-chart-card">
            <div class="etf-holdings-chart-card-head">
              <p class="eyebrow">By Sector</p>
              <span>${escapeHtml(formatPct(sectors[0]?.weight_pct || 0))} top sector</span>
            </div>
            <div class="etf-holdings-chart">
              <div id="etf-holdings-sector-pie"></div>
              <div class="etf-holdings-legend" id="etf-holdings-sector-legend"></div>
            </div>
          </div>
          <div class="etf-holdings-chart-card">
            <div class="etf-holdings-chart-card-head">
              <p class="eyebrow">By Ticker</p>
              <span>${escapeHtml(formatPct(tickerWeights[0]?.weight_pct || 0))} top holding</span>
            </div>
            <div class="etf-holdings-chart">
              <div id="etf-holdings-ticker-pie"></div>
              <div class="etf-holdings-legend" id="etf-holdings-ticker-legend"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="etf-holdings-panel">
        <div class="etf-holdings-table-wrap">
          <table class="etf-holdings-table">
            <thead>
              <tr>${displayColumns.map((column) => `<th>${escapeHtml(labelize(column))}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${sortedRows.map((row) => {
                return `<tr>${displayColumns.map((column) => `<td>${escapeHtml(formatHoldingsCell(column, row[column]))}</td>`).join("")}</tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const summaryEl = $("#etf-holdings-summary");
  if (summaryEl) {
    summaryEl.innerHTML = [
      `Sectors <strong>${escapeHtml(String(sectors.length))}</strong>`,
      `Top Sector <strong>${escapeHtml(sectors[0]?.sector || "—")}</strong>`,
      `Top Weight <strong>${escapeHtml(formatPct(sectors[0]?.weight_pct))}</strong>`,
    ].map((item) => `<span>${item}</span>`).join("");
  }

  renderPieChart($("#etf-holdings-sector-pie"), sectors, "Sectors");
  renderLegend($("#etf-holdings-sector-legend"), sectors);
  renderPieChart($("#etf-holdings-ticker-pie"), tickerWeights, "Tickers");
  renderLegend($("#etf-holdings-ticker-legend"), tickerWeights);
  setStatusText(uniqueRows.length, sectors.length);
  setStatus(`${uniqueRows.length} holdings · ${sectors.length} sectors`, false);
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];
  rows.forEach((row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    const key = symbol || `${String(row?.name || "").trim()}|${String(row?.weight_pct || "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

function normalizeSectors(sectorBreakdown, rows) {
  if (Array.isArray(sectorBreakdown) && sectorBreakdown.length) {
    return sectorBreakdown
      .map((row) => ({
        sector: row.sector || "Unknown",
        weight_pct: Number(row.weight_pct) || 0,
      }))
      .filter((row) => row.weight_pct > 0)
      .sort((a, b) => b.weight_pct - a.weight_pct);
  }

  const grouped = new Map();
  rows.forEach((row) => {
    const sector = row.sector || "Unknown";
    const weight = Number(row.weight_pct) || 0;
    grouped.set(sector, (grouped.get(sector) || 0) + weight);
  });
  return [...grouped.entries()]
    .map(([sector, weight_pct]) => ({ sector, weight_pct }))
    .sort((a, b) => b.weight_pct - a.weight_pct);
}

function normalizeTickerWeights(rows, limit = 10) {
  const grouped = rows.reduce((map, row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase() || "UNKNOWN";
    const name = String(row?.name || "").trim();
    const weight = Number(row?.weight_pct) || 0;
    const current = map.get(symbol) || { symbol, name, weight_pct: 0 };
    current.weight_pct += weight;
    if (!current.name && name) current.name = name;
    map.set(symbol, current);
    return map;
  }, new Map());

  const sorted = [...grouped.values()].sort((a, b) => b.weight_pct - a.weight_pct);
  if (sorted.length <= limit) {
    return sorted;
  }

  const top = sorted.slice(0, limit - 1);
  const other = sorted.slice(limit - 1).reduce((sum, item) => sum + item.weight_pct, 0);
  if (other > 0) {
    top.push({ symbol: "Other", name: "Other", weight_pct: other });
  }
  return top;
}

function renderPieChart(container, items, ariaLabel) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="ticker-info-empty">No data available.</div>`;
    return;
  }

  const size = 300;
  const radius = 110;
  const cx = size / 2;
  const cy = size / 2;
  const total = items.reduce((sum, item) => sum + item.weight_pct, 0) || 1;
  let angle = -Math.PI / 2;

  const slices = items.map((item, index) => {
    const frac = item.weight_pct / total;
    const nextAngle = angle + frac * Math.PI * 2;
    const path = describeArc(cx, cy, radius, angle, nextAngle);
    const color = PALETTE[index % PALETTE.length];
    angle = nextAngle;
    return `<path d="${path}" fill="${color}" stroke="var(--bg)" stroke-width="2"></path>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="100%" height="300" role="img" aria-label="ETF ${escapeHtml(ariaLabel)} pie chart">
      ${slices}
      <circle cx="${cx}" cy="${cy}" r="${radius * 0.48}" fill="var(--bg)"></circle>
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="var(--text)" font-size="16" font-family="Syne, sans-serif" font-weight="700">${escapeHtml(ariaLabel)}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="var(--text-3)" font-size="10" letter-spacing="0.16em">Weight %</text>
    </svg>`;
}

function renderLegend(container, items) {
  if (!container) return;
  container.innerHTML = items.map((item, index) => `
    <div class="etf-holdings-legend-item">
      <span class="etf-holdings-legend-swatch" style="background:${PALETTE[index % PALETTE.length]}"></span>
      <span class="etf-holdings-legend-text">${escapeHtml(item.sector || item.name || item.symbol)} · ${escapeHtml(formatPct(item.weight_pct))}</span>
    </div>
  `).join("");
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
  return [
    "M", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    "L", cx, cy,
    "Z",
  ].join(" ");
}

function polarToCartesian(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function formatHoldingsCell(column, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (column === "weight_pct") return formatPct(value);
  return formatValue(value);
}

function formatPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(2)}%`;
}

function labelize(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function setStatusText(rows, sectors) {
  const meta = $("#result-meta");
  if (meta) meta.textContent = `${rows} holdings · ${sectors} sectors`;
}
