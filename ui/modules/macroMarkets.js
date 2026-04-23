import { state } from "/modules/state.js";
import { $, $$ } from "/modules/dom.js";
import { setStatus } from "/modules/data.js";
import { renderTable, formatValue } from "/modules/table.js";

const MACRO_TABS = [
  { key: "gdp", label: "GDP" },
  { key: "cpi", label: "CPI" },
  { key: "pce", label: "PCE" },
  { key: "labor", label: "Labor" },
  { key: "unemployment", label: "Unemployment" },
  { key: "treasury", label: "Treasury" },
  { key: "fed_funds", label: "Fed Funds" },
  { key: "credit", label: "Credit" },
  { key: "liquidity", label: "Liquidity" },
  { key: "housing", label: "Housing" },
  { key: "consumer", label: "Consumer" },
];

const TAB_COLORS = ["#C8FF00", "#4FC3F7", "#FFB800", "#00E5A0", "#FF8A65", "#B388FF"];

export async function runMacroMarket(tab, options) {
  const { clientCacheTtlMs } = options;
  const activeTab = normalizeTab(tab || state.marketsMacroTab || "gdp");
  state.marketsSub = "macro";
  state.marketsMacroTab = activeTab;

  setMacroShellVisible(true);
  renderMacroTabs(activeTab);
  setActiveMacroNav(activeTab);

  $(".results").classList.remove("hidden");
  $("#summary").innerHTML = "";
  $("#result-title").textContent = "MacroTracker";
  $("#result-table").innerHTML = "";
  $("#result-meta").textContent = "";
  setStatus("Loading…", false);

  try {
    const payload = await getMacroData(activeTab, clientCacheTtlMs);
    renderMacro(payload);
  } catch (error) {
    $("#markets-macro-chart").innerHTML = `<div class="chart-empty">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, true);
  }
}

export function bindMacroMarkets(onSelect) {
  const tabs = $("#markets-macro-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-macro-tab]");
    if (!btn) return;
    onSelect(btn.dataset.macroTab);
  });
}

export function setMacroShellVisible(visible) {
  const shell = $("#markets-macro-shell");
  if (!shell) return;
  shell.classList.toggle("hidden", !visible);
  if (!visible) {
    const chart = $("#markets-macro-chart");
    const title = $("#markets-macro-title");
    const meta = $("#markets-macro-meta");
    if (chart) chart.innerHTML = `<div class="chart-empty">Select a macro tab to load data.</div>`;
    if (title) title.textContent = "Macro";
    if (meta) meta.textContent = "";
  }
}

function renderMacroTabs(activeTab) {
  const tabs = $("#markets-macro-tabs");
  if (!tabs) return;
  tabs.innerHTML = MACRO_TABS.map(
    (tab) => `<button class="markets-macro-tab${tab.key === activeTab ? " active" : ""}" type="button" data-macro-tab="${tab.key}">${tab.label}</button>`
  ).join("");
}

function setActiveMacroNav(activeTab) {
  $$(".nav-group-markets [data-macro-tab]").forEach((link) => {
    link.classList.toggle("active", link.dataset.macroTab === activeTab);
  });
}

async function getMacroData(tab, clientCacheTtlMs) {
  const cached = state.macroCache?.get(tab);
  if (cached && Date.now() - cached.fetchedAt < clientCacheTtlMs) {
    return cached.data;
  }
  const response = await fetch(`/api/macro?tab=${encodeURIComponent(tab)}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  if (!state.macroCache) state.macroCache = new Map();
  state.macroCache.set(tab, { fetchedAt: Date.now(), data });
  return data;
}

function renderMacro(payload) {
  const chartContainer = $("#markets-macro-chart");
  const title = $("#markets-macro-title");
  const meta = $("#markets-macro-meta");
  const rows = payload?.data?.rows || [];
  const columns = payload?.data?.columns || [];
  const chartColumns = payload?.chart_columns || [];
  const xKey = payload?.x_column || "observation_date";
  const activeSeries = chartColumns.filter((column) => columns.includes(column));

  title.textContent = payload.title || "Macro";
  meta.textContent = `${rows.length} rows`;
  renderTable(payload.data);
  chartContainer.innerHTML = "";

  if (!rows.length || !activeSeries.length) {
    chartContainer.innerHTML = `<div class="chart-empty">No chart data available.</div>`;
    setStatus(`${rows.length} rows`, false);
    return;
  }

  chartContainer.appendChild(renderLineChart([...rows].reverse(), xKey, activeSeries));

  const cacheNote = payload.cache ? ` · ${payload.cache.status}` : "";
  setStatus(`${rows.length} rows${cacheNote}`, false);
  $("#result-title").textContent = payload.title || "MacroTracker";
  if (payload.warning) {
    setStatus(payload.warning, true);
  }
}

function renderLineChart(rows, xKey, seriesKeys) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1120;
  const H = 320;
  const M = { top: 18, right: 24, bottom: 48, left: 62 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";
  svg.style.overflow = "visible";

  const seriesData = seriesKeys.map((key) => ({
    key,
    points: rows.map((row, index) => {
      const x = rows.length === 1
        ? M.left + innerW / 2
        : M.left + (innerW * index) / (rows.length - 1);
      const y = row[key] == null ? null : Number(row[key]);
      const yPos = Number.isFinite(y)
        ? M.top + innerH - ((y - 0) / 1)
        : null;
      return {
        index,
        x,
        y,
        label: row[xKey],
        row,
      };
    })
  })).filter((series) => series.points.some((point) => Number.isFinite(point.y)));

  if (!seriesData.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "No chart data available.";
    return empty;
  }

  const allValues = seriesData
    .flatMap((series) => series.points.map((point) => point.y))
    .filter((value) => Number.isFinite(value));
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const pad = yMax === yMin ? (Math.abs(yMax) || 1) * 0.1 : (yMax - yMin) * 0.08;
  const minY = yMin - pad;
  const maxY = yMax + pad;

  const gridCount = 4;
  for (let i = 0; i <= gridCount; i += 1) {
    const y = M.top + (innerH / gridCount) * i;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", M.left);
    line.setAttribute("x2", W - M.right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "#202020");
    svg.appendChild(line);
  }

  seriesData.forEach((series, seriesIndex) => {
    const color = TAB_COLORS[seriesIndex % TAB_COLORS.length];
    const points = series.points;
    const path = document.createElementNS(NS, "path");
    const dParts = [];
    let started = false;
    points.forEach((point) => {
      if (!Number.isFinite(point.y)) {
        started = false;
        return;
      }
      const y = M.top + innerH - ((point.y - minY) / (maxY - minY || 1)) * innerH;
      dParts.push(`${started ? "L" : "M"}${point.x.toFixed(2)} ${y.toFixed(2)}`);
      started = true;
    });
    const d = dParts.join(" ");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);

    const last = [...points].reverse().find((point) => Number.isFinite(point.y));
    if (last) {
      const y = M.top + innerH - ((last.y - minY) / (maxY - minY || 1)) * innerH;
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", last.x);
      dot.setAttribute("cy", y);
      dot.setAttribute("r", "3.5");
      dot.setAttribute("fill", color);
      svg.appendChild(dot);
    }
  });

  const firstLabel = rows[0]?.[xKey];
  const lastLabel = rows[rows.length - 1]?.[xKey];
  const xLeftLabel = document.createElementNS(NS, "text");
  xLeftLabel.setAttribute("x", M.left);
  xLeftLabel.setAttribute("y", H - 12);
  xLeftLabel.setAttribute("fill", "#5c5c5c");
  xLeftLabel.setAttribute("text-anchor", "start");
  xLeftLabel.setAttribute("font-size", "10");
  xLeftLabel.textContent = formatMacroDate(firstLabel);
  svg.appendChild(xLeftLabel);

  const xRightLabel = document.createElementNS(NS, "text");
  xRightLabel.setAttribute("x", W - M.right);
  xRightLabel.setAttribute("y", H - 12);
  xRightLabel.setAttribute("fill", "#5c5c5c");
  xRightLabel.setAttribute("text-anchor", "end");
  xRightLabel.setAttribute("font-size", "10");
  xRightLabel.textContent = formatMacroDate(lastLabel);
  svg.appendChild(xRightLabel);

  const yMinLabel = document.createElementNS(NS, "text");
  yMinLabel.setAttribute("x", M.left - 10);
  yMinLabel.setAttribute("y", H - M.bottom);
  yMinLabel.setAttribute("fill", "#5c5c5c");
  yMinLabel.setAttribute("text-anchor", "end");
  yMinLabel.setAttribute("font-size", "10");
  yMinLabel.textContent = formatValue(minY);
  svg.appendChild(yMinLabel);

  const yMaxLabel = document.createElementNS(NS, "text");
  yMaxLabel.setAttribute("x", M.left - 10);
  yMaxLabel.setAttribute("y", M.top + 4);
  yMaxLabel.setAttribute("fill", "#5c5c5c");
  yMaxLabel.setAttribute("text-anchor", "end");
  yMaxLabel.setAttribute("font-size", "10");
  yMaxLabel.textContent = formatValue(maxY);
  svg.appendChild(yMaxLabel);

  const legend = document.createElement("div");
  legend.className = "macro-chart-legend";
  seriesData.forEach((series, index) => {
    const item = document.createElement("span");
    item.className = "macro-chart-legend-item";
    item.innerHTML = `<span class="macro-chart-legend-swatch" style="--macro-color: ${TAB_COLORS[index % TAB_COLORS.length]}"></span>${escapeHtml(labelize(series.key))}`;
    legend.appendChild(item);
  });

  const wrapper = document.createElement("div");
  wrapper.className = "macro-chart-shell";
  wrapper.style.position = "relative";
  wrapper.appendChild(svg);
  wrapper.appendChild(legend);

  const hoverLine = document.createElement("div");
  hoverLine.className = "macro-chart-hover-line hidden";
  hoverLine.style.left = `${M.left}px`;
  hoverLine.style.top = `${M.top}px`;
  hoverLine.style.height = `${innerH}px`;
  wrapper.appendChild(hoverLine);

  const hoverTooltip = document.createElement("div");
  hoverTooltip.className = "macro-chart-tooltip hidden";
  wrapper.appendChild(hoverTooltip);

  const hoverOverlay = document.createElementNS(NS, "rect");
  hoverOverlay.setAttribute("x", M.left);
  hoverOverlay.setAttribute("y", M.top);
  hoverOverlay.setAttribute("width", innerW);
  hoverOverlay.setAttribute("height", innerH);
  hoverOverlay.setAttribute("fill", "transparent");
  hoverOverlay.style.cursor = "crosshair";
  svg.appendChild(hoverOverlay);

  const pointMarkers = seriesData.map((series, index) => {
    const marker = document.createElementNS(NS, "circle");
    marker.setAttribute("r", "4");
    marker.setAttribute("fill", TAB_COLORS[index % TAB_COLORS.length]);
    marker.setAttribute("opacity", "0");
    svg.appendChild(marker);
    return marker;
  });

  const setHoverState = (event) => {
    const rect = svg.getBoundingClientRect();
    const clientX = Math.min(Math.max(event.clientX, rect.left + M.left), rect.right - M.right);
    const ratio = (clientX - rect.left - M.left) / (rect.width - M.left - M.right);
    const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
    const row = rows[index];
    if (!row) return;

    const x = rows.length === 1
      ? M.left + innerW / 2
      : M.left + (innerW * index) / (rows.length - 1);
    hoverLine.style.transform = `translateX(${x - M.left}px)`;
    hoverLine.classList.remove("hidden");
    hoverLine.style.opacity = "1";

    const lines = [
      `<div class="macro-chart-tooltip-date">${escapeHtml(formatMacroDate(row[xKey]))}</div>`,
    ];
    seriesData.forEach((series, seriesIndex) => {
      const point = series.points[index];
      const color = TAB_COLORS[seriesIndex % TAB_COLORS.length];
      const value = point && Number.isFinite(point.y) ? formatValue(point.y) : "—";
      const y = point && Number.isFinite(point.y)
        ? M.top + innerH - ((point.y - minY) / (maxY - minY || 1)) * innerH
        : null;
      if (pointMarkers[seriesIndex]) {
        pointMarkers[seriesIndex].setAttribute("cx", point ? point.x : x);
        pointMarkers[seriesIndex].setAttribute("cy", y == null ? M.top + innerH : y);
        pointMarkers[seriesIndex].setAttribute("opacity", point && Number.isFinite(point.y) ? "1" : "0");
      }
      lines.push(
        `<div class="macro-chart-tooltip-row"><span class="macro-chart-tooltip-swatch" style="--macro-color: ${color}"></span><span>${escapeHtml(labelize(series.key))}</span><span>${escapeHtml(value)}</span></div>`
      );
    });
    hoverTooltip.innerHTML = lines.join("");
    hoverTooltip.classList.remove("hidden");

    const tooltipWidth = 220;
    const tooltipHeight = Math.min(20 + seriesData.length * 22, 260);
    const leftPx = Math.min(Math.max(x + 18, M.left), W - M.right - tooltipWidth);
    const topPx = Math.min(Math.max(M.top + 8, event.offsetY + 20), H - tooltipHeight - 8);
    hoverTooltip.style.left = `${leftPx}px`;
    hoverTooltip.style.top = `${topPx}px`;
  };

  hoverOverlay.addEventListener("mousemove", setHoverState);
  hoverOverlay.addEventListener("mouseenter", setHoverState);
  hoverOverlay.addEventListener("mouseleave", () => {
    hoverLine.classList.add("hidden");
    hoverTooltip.classList.add("hidden");
    pointMarkers.forEach((marker) => marker.setAttribute("opacity", "0"));
  });

  return wrapper;
}

function normalizeTab(tab) {
  return MACRO_TABS.some((item) => item.key === tab) ? tab : "gdp";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function labelize(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMacroDate(value) {
  if (value == null) return "—";
  const str = String(value);
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${monthNames[Number(month) - 1] || month} ${Number(day)}, ${year}`;
  }
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return str;
}
