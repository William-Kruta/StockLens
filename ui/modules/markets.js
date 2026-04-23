import { state } from "/modules/state.js";
import { $, $$ } from "/modules/dom.js";
import { setStatus } from "/modules/data.js";
import {
  renderTable,
  formatValue,
  cleanMarketSymbol,
  parseSignedNumber,
} from "/modules/table.js";
import { runMacroMarket, setMacroShellVisible } from "/modules/macroMarkets.js";

export async function runMarkets(sub, options) {
  const { openTickerPage, updateLlmContextBar, clientCacheTtlMs, macroTab } = options;
  if (sub === "macro") {
    return runMacroMarket(macroTab || state.marketsMacroTab || "gdp", {
      clientCacheTtlMs,
    });
  }
  setMacroShellVisible(false);
  state.marketsSub = sub;
  $$(".markets-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.marketsSub === sub);
  });
  $$(".markets-tab-parent").forEach((p) => p.classList.remove("active"));
  const activeBtn = $(`.markets-tab[data-markets-sub="${sub}"]`);
  if (activeBtn) {
    activeBtn.closest(".markets-tab-group")
      ?.querySelector(".markets-tab-parent")
      ?.classList.add("active");
  }

  $(".results").classList.remove("hidden");
  $("#summary").innerHTML = "";
  $("#result-title").textContent = "Markets";
  $("#result-table").innerHTML = "";
  $("#result-meta").textContent = "";
  setStatus("Loading…", false);

  try {
    const { data, source } = await getMarketsData(sub, clientCacheTtlMs);
    renderMarkets(data, source, { openTickerPage, updateLlmContextBar });
  } catch (error) {
    setStatus(error.message, true);
  }
}

export async function runDashboard(items, options) {
  $(".results").classList.add("hidden");
  await Promise.all(items.map((item) => loadDashboardMarket(item, options.clientCacheTtlMs)));
  loadDashboardIndexes();
  loadDashboardFutures();
}

export function bindMarkets(runMarketsForSub) {
  $$(".markets-tab").forEach((btn) => {
    if (!btn.dataset.marketsSub) return;
    btn.addEventListener("click", () => runMarketsForSub(btn.dataset.marketsSub));
  });
}

export function bindDashboard(openDashboardMarket) {
  $$("[data-dashboard-market]").forEach((card) => {
    card.addEventListener("click", () => openDashboardMarket(card.dataset.dashboardMarket));
  });
}

async function getMarketsData(sub, clientCacheTtlMs) {
  const cached = state.marketsCache.get(sub);
  if (cached && Date.now() - cached.fetchedAt < clientCacheTtlMs) {
    return { data: cached.data, source: "client" };
  }

  const response = await fetch(`/api/markets?sub=${encodeURIComponent(sub)}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  state.marketsCache.set(sub, { fetchedAt: Date.now(), data });
  return { data, source: "server" };
}

function renderMarkets(data, source, options) {
  const { openTickerPage, updateLlmContextBar } = options;
  $("#result-title").textContent = data.title;
  renderTable(data.data);

  const symbolColumn = data.data.columns.find((column) => column.toLowerCase() === "symbol");
  const nameColumn = data.data.columns.find((column) => column.toLowerCase() === "name");
  $$("#result-table tbody tr").forEach((tr, index) => {
    const row = data.data.rows[index];
    const symbol = cleanMarketSymbol(row?.[symbolColumn]);
    const name = row?.[nameColumn]?.toString().trim() || symbol;
    if (!symbol) return;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openTickerPage(symbol, name));
  });

  const cache = data.cache;
  let cacheNote = "live";
  if (source === "client") {
    cacheNote = "client cache";
  } else if (cache?.market_date) {
    cacheNote = `${cache.status} cache for ${cache.market_date}`;
  } else if (cache) {
    cacheNote = `${cache.status} cache, ${cache.age_seconds}s old`;
  }
  const warning = data.warning ? ` · ${data.warning}` : "";
  setStatus(`${data.data.rows.length} tickers · ${cacheNote}${warning}`, false);
  if (state.llmOpen) updateLlmContextBar();
}

async function loadDashboardMarket(item, clientCacheTtlMs) {
  const target = $(`#${item.id}`);
  if (!target) return;
  target.innerHTML = `<div class="dashboard-loading">Loading...</div>`;
  try {
    const { data } = await getMarketsData(item.sub, clientCacheTtlMs);
    renderDashboardMarket(target, data);
  } catch (error) {
    target.innerHTML = `<div class="dashboard-empty">${error.message}</div>`;
  }
}

function renderDashboardMarket(target, data) {
  const rows = data?.data?.rows || [];
  const columns = data?.data?.columns || [];
  const symbolColumn = columns.find((column) => column.toLowerCase() === "symbol");
  const nameColumn = columns.find((column) => column.toLowerCase() === "name");
  const changeColumn = columns.find((column) => column.toLowerCase() === "change %")
    || columns.find((column) => /^change/i.test(column));
  target.innerHTML = "";

  rows.slice(0, 5).forEach((row) => {
    const symbol = cleanMarketSymbol(row?.[symbolColumn]);
    const name = row?.[nameColumn]?.toString().trim() || symbol;
    const change = changeColumn ? formatValue(row?.[changeColumn]) : "";
    const div = document.createElement("div");
    div.className = "dashboard-mini-row";
    div.innerHTML = `
      <span class="dashboard-symbol"></span>
      <span class="dashboard-name"></span>
      <span class="dashboard-change"></span>
    `;
    div.querySelector(".dashboard-symbol").textContent = symbol;
    div.querySelector(".dashboard-name").textContent = name;
    const changeEl = div.querySelector(".dashboard-change");
    changeEl.textContent = change;
    const numeric = parseSignedNumber(change);
    if (numeric !== null && numeric !== 0) {
      changeEl.classList.add(numeric > 0 ? "value-positive" : "value-negative");
    }
    target.appendChild(div);
  });

  if (!target.children.length) {
    target.innerHTML = `<div class="dashboard-empty">No rows returned.</div>`;
  }
}

async function loadDashboardIndexes() {
  const strip = $("#dashboard-index-strip");
  const meta = $("#dashboard-index-meta");
  if (!strip || !meta) return;
  strip.innerHTML = `<div class="dashboard-loading">Loading...</div>`;
  meta.textContent = "Loading...";
  try {
    const response = await fetch("/api/dashboard-indexes");
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    renderDashboardIndexes(data);
  } catch (error) {
    meta.textContent = "Unavailable";
    strip.innerHTML = `<div class="dashboard-empty">${error.message}</div>`;
  }
}

function renderDashboardIndexes(data) {
  const strip = $("#dashboard-index-strip");
  const meta = $("#dashboard-index-meta");
  strip.innerHTML = "";
  (data.indexes || []).forEach((item) => {
    const change = typeof item.change_pct === "number" ? item.change_pct : null;
    const tile = document.createElement("div");
    tile.className = "index-tile";
    tile.innerHTML = `
      <div class="index-name"></div>
      <div class="index-symbol"></div>
      <div class="index-change"></div>
    `;
    tile.querySelector(".index-name").textContent = item.name;
    tile.querySelector(".index-symbol").textContent = item.symbol;
    const changeEl = tile.querySelector(".index-change");
    changeEl.textContent = change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    if (change !== null && change !== 0) {
      changeEl.classList.add(change > 0 ? "value-positive" : "value-negative");
    }
    strip.appendChild(tile);
  });
  if (!strip.children.length) {
    strip.innerHTML = `<div class="dashboard-empty">No index data returned.</div>`;
  }
  const cache = data.cache;
  meta.textContent = cache ? `${cache.status} cache, ${cache.age_seconds}s old` : "Latest close";
}

async function loadDashboardFutures() {
  const strip = $("#dashboard-futures-strip");
  const meta = $("#dashboard-futures-meta");
  if (!strip || !meta) return;
  strip.innerHTML = `<div class="dashboard-loading">Loading...</div>`;
  meta.textContent = "Loading...";
  try {
    const response = await fetch("/api/dashboard-futures");
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    renderDashboardFutures(data);
  } catch (error) {
    meta.textContent = "Unavailable";
    strip.innerHTML = `<div class="dashboard-empty">${error.message}</div>`;
  }
}

function renderDashboardFutures(data) {
  const strip = $("#dashboard-futures-strip");
  const meta = $("#dashboard-futures-meta");
  strip.innerHTML = "";
  (data.items || []).forEach((item) => {
    const change = typeof item.change_pct === "number" ? item.change_pct : null;
    const tile = document.createElement("div");
    tile.className = "index-tile";
    tile.innerHTML = `
      <div class="index-name"></div>
      <div class="index-symbol"></div>
      <div class="index-price"></div>
      <div class="index-change"></div>
    `;
    tile.querySelector(".index-name").textContent = item.name;
    tile.querySelector(".index-symbol").textContent = item.symbol;
    tile.querySelector(".index-price").textContent = item.close == null ? "—" : formatValue(item.close);
    const changeEl = tile.querySelector(".index-change");
    changeEl.textContent = change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    if (change !== null && change !== 0) {
      changeEl.classList.add(change > 0 ? "value-positive" : "value-negative");
    }
    strip.appendChild(tile);
  });
  if (!strip.children.length) {
    strip.innerHTML = `<div class="dashboard-empty">No futures data returned.</div>`;
  }
  const cache = data.cache;
  meta.textContent = cache ? `${cache.status} cache, ${cache.age_seconds}s old` : "Latest close";
}
