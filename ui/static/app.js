import { state } from "/modules/state.js";
import { $, $$ } from "/modules/dom.js";
import { post, setStatus } from "/modules/data.js";
import { renderTable, renderSummary, formatValue } from "/modules/table.js";
import {
  bindTickerFinancialsControls,
  runTickerFinancials,
} from "/modules/tickerFinancials.js";
import {
  bindDashboard as bindDashboardModule,
  bindMarkets as bindMarketsModule,
  runDashboard as runDashboardModule,
  runMarkets as runMarketsModule,
} from "/modules/markets.js";
import {
  bindMacroMarkets as bindMacroMarketsModule,
  setMacroShellVisible as setMacroShellVisibleModule,
} from "/modules/macroMarkets.js";
import {
  bindPredictionMarkets as bindPredictionMarketsModule,
  runPredictionMarkets as runPredictionMarketsModule,
  setPredictionShellVisible as setPredictionShellVisibleModule,
} from "/modules/predictionMarkets.js";
import { initSearch as initSearchModule } from "/modules/search.js";
import {
  bindOptionScreener,
  renderOptionScreenerWatchlists,
} from "/modules/optionScreener.js";
import {
  runTickerOptions as runTickerOptionsModule,
  runTickerInfo as runTickerInfoModule,
  runTickerInsider as runTickerInsiderModule,
  runCryptoAddresses as runCryptoAddressesModule,
} from "/modules/tickerDetails.js";
import { runTickerEarnings as runTickerEarningsModule } from "/modules/tickerEarnings.js";
import { runTickerDividends as runTickerDividendsModule } from "/modules/tickerDividends.js";
import { runEtfHoldings as runEtfHoldingsModule } from "/modules/etfHoldings.js";
import { escapeHtml, tickerList, uniqueTickers } from "/modules/utils.js";

// Color + group metadata for each indicator key
const INDICATOR_DEFS = {
  sma_20: { color: "#4FC3F7", group: "overlay" },
  sma_50: { color: "#FFB800", group: "overlay" },
  sma_200: { color: "#FF4B4B", group: "overlay" },
  ema_12: { color: "#00E5A0", group: "overlay" },
  ema_26: { color: "#FF8A65", group: "overlay" },
  bb: { color: "#B388FF", group: "overlay" },
  macd: { color: "#4FC3F7", group: "panel" },
  rsi: { color: "#C8FF00", group: "panel" },
  atr: { color: "#FFB800", group: "panel" },
};
const COMPARE_COLORS = ["#4FC3F7", "#FFB800", "#FF4B4B", "#00E5A0", "#FF8A65", "#B388FF"];
const DASHBOARD_MARKETS = [
  { sub: "gainers", id: "dashboard-gainers", label: "Gainers" },
  { sub: "losers", id: "dashboard-losers", label: "Losers" },
  { sub: "unusual_volume", id: "dashboard-unusual-volume", label: "Unusual Volume" },
];

// ── LLM Sidebar ────────────────────────────────────────────────

const LLM_URL_KEY = "secrs.llm_server_url";
const LLM_HISTORY_MAX = 20;
const MARKETS_CLIENT_CACHE_TTL_MS = 60_000;

function loadLlmSettings() {
  return {
    serverUrl: localStorage.getItem(LLM_URL_KEY) || "http://localhost:8080",
  };
}

function saveLlmSettings(url) {
  localStorage.setItem(LLM_URL_KEY, url.trim().replace(/\/$/, ""));
}

const CHAT_STORAGE_KEY = "secrs.chat.conversations";
const CHAT_SETTINGS_KEY = "secrs.chat.settings";
const CHAT_RESEARCH_EFFORT_KEY = "secrs.chat.research_effort";
const CHAT_MODELS = {
  claude: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};
const CHAT_COMMANDS = [
  {
    key: "tickers",
    token: "@tickers/",
    label: "Ticker context",
    hint: "@tickers/AAPL",
    description: "Inject ticker metadata into the prompt.",
  },
];
const CHAT_MARKET_COMMANDS = [
  { token: "@markets/most_active", label: "Markets · Most Active", hint: "@markets/most_active" },
  { token: "@markets/gainers", label: "Markets · Top Gainers", hint: "@markets/gainers" },
  { token: "@markets/losers", label: "Markets · Top Losers", hint: "@markets/losers" },
  { token: "@markets/trending", label: "Markets · Trending", hint: "@markets/trending" },
  { token: "@markets/unusual_volume", label: "Markets · Unusual Volume", hint: "@markets/unusual_volume" },
  { token: "@markets/small_cap", label: "Markets · Small Cap", hint: "@markets/small_cap" },
  { token: "@markets/ipo", label: "Markets · IPO", hint: "@markets/ipo" },
  { token: "@markets/private_companies", label: "Markets · Private Companies", hint: "@markets/private_companies" },
  { token: "@markets/insider_cluster_buys", label: "Markets · Insider Cluster Buys", hint: "@markets/insider_cluster_buys" },
  { token: "@markets/macro/gdp", label: "Markets · Macro · GDP", hint: "@markets/macro/gdp" },
  { token: "@markets/macro/cpi", label: "Markets · Macro · CPI", hint: "@markets/macro/cpi" },
  { token: "@markets/macro/pce", label: "Markets · Macro · PCE", hint: "@markets/macro/pce" },
  { token: "@markets/macro/labor", label: "Markets · Macro · Labor", hint: "@markets/macro/labor" },
  { token: "@markets/macro/unemployment", label: "Markets · Macro · Unemployment", hint: "@markets/macro/unemployment" },
  { token: "@markets/macro/treasury", label: "Markets · Macro · Treasury", hint: "@markets/macro/treasury" },
  { token: "@markets/macro/fed_funds", label: "Markets · Macro · Fed Funds", hint: "@markets/macro/fed_funds" },
  { token: "@markets/macro/credit", label: "Markets · Macro · Credit", hint: "@markets/macro/credit" },
  { token: "@markets/macro/liquidity", label: "Markets · Macro · Liquidity", hint: "@markets/macro/liquidity" },
  { token: "@markets/macro/housing", label: "Markets · Macro · Housing", hint: "@markets/macro/housing" },
  { token: "@markets/macro/consumer", label: "Markets · Macro · Consumer", hint: "@markets/macro/consumer" },
  { token: "@markets/prediction/all", label: "Prediction Markets · All", hint: "@markets/prediction/all" },
  { token: "@markets/prediction/sports", label: "Prediction Markets · Sports", hint: "@markets/prediction/sports" },
  { token: "@markets/prediction/crypto", label: "Prediction Markets · Crypto", hint: "@markets/prediction/crypto" },
  { token: "@markets/prediction/politics", label: "Prediction Markets · Politics", hint: "@markets/prediction/politics" },
  { token: "@markets/prediction/economics", label: "Prediction Markets · Economics", hint: "@markets/prediction/economics" },
  { token: "@markets/prediction/weather", label: "Prediction Markets · Weather", hint: "@markets/prediction/weather" },
  { token: "@markets/prediction/technology", label: "Prediction Markets · Technology", hint: "@markets/prediction/technology" },
  { token: "@markets/prediction/entertainment", label: "Prediction Markets · Entertainment", hint: "@markets/prediction/entertainment" },
  { token: "@markets/prediction/energy", label: "Prediction Markets · Energy", hint: "@markets/prediction/energy" },
  { token: "@markets/prediction/other", label: "Prediction Markets · Other", hint: "@markets/prediction/other" },
];
const CHAT_AUTOCOMPLETE_LIMIT = 8;

function runMarkets(sub = "most_active", macroTab = null) {
  if (sub === "prediction") {
    setMacroShellVisibleModule(false);
    setPredictionShellVisibleModule(true);
    return runPredictionMarketsModule(normalizePredictionTab(macroTab || state.marketsPredictionTab || "all"), {
      openTickerPage,
      updateLlmContextBar,
      clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
    });
  }
  setPredictionShellVisibleModule(false);
  return runMarketsModule(sub, {
    openTickerPage,
    updateLlmContextBar,
    clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
    macroTab,
  });
}

function runDashboard() {
  return runDashboardModule(DASHBOARD_MARKETS, {
    clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
  });
}

function bindMarkets() {
  bindMarketsModule((sub) => runMarkets(sub));
}

function bindMacroMarkets() {
  bindMacroMarketsModule((tab) => openMarkets("macro", false, tab));
}

function bindPredictionMarkets() {
  bindPredictionMarketsModule();
}

function bindDashboard() {
  bindDashboardModule((sub) => openDashboardMarket(sub));

  // ✦ Quick-ask buttons on each dashboard card
  $$("[data-dashboard-llm]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // don't trigger the card's own click
      sendDashboardLlmQuery(btn.dataset.dashboardLlm);
    });
  });
}

function initSearch() {
  initSearchModule(openTickerPage);
}

function runTickerInfo() {
  return runTickerInfoModule();
}

function runTickerOptions() {
  return runTickerOptionsModule();
}

function runTickerEarnings() {
  return runTickerEarningsModule();
}

function runTickerDividends() {
  return runTickerDividendsModule();
}

function runTickerHoldings() {
  return runEtfHoldingsModule();
}

function runTickerInsider() {
  return runTickerInsiderModule();
}

function runCryptoAddresses() {
  return runCryptoAddressesModule();
}

function runPredictionMarkets(tab = "all", options = {}) {
  return runPredictionMarketsModule(tab, {
    clientCacheTtlMs: MARKETS_CLIENT_CACHE_TTL_MS,
    ...options,
  });
}

function clearChartAnalysis() {
  state.chartAnalysis = null;
  state.chartAnalysisSelectedIndex = 0;
  const panel = $("#chart-analysis-panel");
  const body = $("#chart-analysis-body");
  const meta = $("#chart-analysis-meta");
  if (panel) panel.classList.add("hidden");
  if (body) body.innerHTML = `<div class="chart-empty">Run analysis to detect patterns and fetch context.</div>`;
  if (meta) meta.textContent = "";
}

function currentChartLookback() {
  const raw = Number(state.chartLiveLookback);
  if (!Number.isFinite(raw)) return 60;
  return Math.min(500, Math.max(10, Math.floor(raw)));
}

function syncLiveLookbackInput() {
  const row = $("#chart-live-lookback-row");
  const input = $("#chart-live-lookback");
  const show = Boolean(state.chartLive || state.chartLivePendingStart);
  if (row) row.classList.toggle("hidden", !show);
  if (input) input.value = String(currentChartLookback());
}

function periodDisplayLabel(period) {
  const normalized = String(period || "").toLowerCase();
  const labels = {
    "1d": "1 day",
    "5d": "5 day",
    "1mo": "1 month",
    "3mo": "3 month",
    "6mo": "6 month",
    "1y": "1 year",
    "5y": "5 year",
    "max": "max",
  };
  return labels[normalized] || normalized.toUpperCase() || "PERIOD";
}

function shouldAutoTickerHeaderLive() {
  if (state.route !== "ticker" || !state.ticker) return false;
  if ((state.assetType || "").toLowerCase() === "crypto") return true;
  const phase = state.marketStatus?.phase;
  return ["pre_market", "open", "post_market"].includes(phase);
}

function updateTickerHeaderPrice(rows = state.chartRows, liveQuote = state.chartLiveQuote) {
  const priceEl = $("#ticker-price");
  const changeEl = $("#ticker-price-change");
  if (!priceEl || !changeEl) return;
  const series = Array.isArray(rows) ? rows : [];
  const latestRow = series.length ? series[series.length - 1] : null;
  const livePrice = Number(liveQuote?.price);
  const price = Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : Number(latestRow?.close);
  const firstClose = Number(series[0]?.close);
  if (!Number.isFinite(price) || price <= 0) {
    priceEl.textContent = "—";
    changeEl.textContent = "—";
    changeEl.className = "ticker-price-change";
    return;
  }
  priceEl.textContent = price.toFixed(price >= 100 ? 2 : 4);
  if (Number.isFinite(firstClose) && firstClose > 0) {
    const pct = ((price - firstClose) / firstClose) * 100;
    const sign = pct > 0 ? "+" : "";
    changeEl.textContent = `(${periodDisplayLabel(state.chartPeriod)} ${sign}${pct.toFixed(2)}%)`;
    changeEl.className = `ticker-price-change ${pct > 0 ? "positive" : pct < 0 ? "negative" : ""}`.trim();
  } else {
    changeEl.textContent = `(${periodDisplayLabel(state.chartPeriod)})`;
    changeEl.className = "ticker-price-change";
  }
}

function updateLiveButtonState() {
  const btn = $("#chart-live-btn");
  if (!btn) return;
  const enabled = Boolean(state.ticker) && state.compareTickers.length === 0 && state.route === "ticker" && state.tickerMainTab === "chart";
  btn.disabled = !enabled || state.chartLivePendingStart;
  btn.setAttribute("aria-pressed", state.chartLive ? "true" : "false");
  btn.classList.toggle("active", state.chartLive);
  btn.classList.toggle("loading", state.chartLivePendingStart);
  btn.querySelector("span:last-child").textContent = state.chartLivePendingStart
    ? "Starting"
    : state.chartLive
      ? "Live"
      : "Live";
  $$(".chart-range").forEach((button) => {
    button.disabled = state.chartLive || state.chartLivePendingStart;
  });
  syncLiveLookbackInput();
}

function updateAnalyzeButtonState() {
  const btn = $("#chart-analyze-btn");
  if (!btn) return;
  const enabled = state.chartRows.length > 0;
  btn.disabled = !enabled || state.compareTickers.length > 0 || state.chartAnalysisLoading || state.chartLive || state.chartLivePendingStart;
}

function rerenderCurrentTickerChart() {
  if (!state.chartRows.length) return;
  const wrap = $("#ticker-chart-wrap");
  if (!wrap) return;
  const activeOverlays = [...state.indicators].filter(
    (k) => INDICATOR_DEFS[k]?.group === "overlay"
  );
  const rows = state.chartLive ? state.chartRows.slice(-currentChartLookback()) : state.chartRows;
  renderCandleChart(
    rows,
    wrap,
    activeOverlays,
    state.chartAnalysis?.rectangles || [],
    state.chartAnalysisSelectedIndex ?? -1,
    state.chartLiveQuote
  );
}

async function refreshTickerHeaderLive() {
  const ticker = state.ticker;
  if (!ticker) return;
  try {
    const candleData = await fetchCandleRows(
      ticker,
      state.chartPeriod || "1mo",
      state.chartInterval || chartIntervalForPeriod(state.chartPeriod || "1mo"),
      false,
      false,
      "live"
    );
    state.chartRows = candleData.rows || [];
    state.chartLiveQuote = candleData.live_quote || null;
    updateTickerHeaderPrice(state.chartRows, state.chartLiveQuote);
  } catch {
    updateTickerHeaderPrice(state.chartRows, state.chartLiveQuote);
  }
}

async function syncTickerHeaderLive() {
  if (state.route !== "ticker" || !state.ticker) return;

  const shouldAuto = shouldAutoTickerHeaderLive();
  const canStart = shouldAuto && !state.chartLivePendingStart;

  if (canStart && !state.tickerHeaderLive && !state.tickerHeaderLivePending) {
    state.tickerHeaderLivePending = true;
    try {
      const response = await fetch("/api/live/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: state.ticker }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
      state.tickerHeaderLive = Boolean(data?.active) && (data?.mode || "socket") === "socket";
      state.tickerHeaderLiveMode = data?.mode || "socket";
      state.tickerHeaderLiveWarning = data?.warning || null;
      if (state.tickerHeaderLive) {
        startChartLiveRefresh();
        await refreshTickerHeaderLive();
      } else {
        updateTickerHeaderPrice();
      }
    } catch (error) {
      state.tickerHeaderLive = false;
      state.tickerHeaderLiveMode = null;
      state.tickerHeaderLiveWarning = error?.message || null;
      updateTickerHeaderPrice();
    } finally {
      state.tickerHeaderLivePending = false;
      updateLiveButtonState();
    }
    return;
  }

  if (!shouldAuto && state.tickerHeaderLive && !state.chartLive && !state.chartLivePendingStart) {
    try {
      await fetch("/api/live/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: state.ticker }),
      });
    } catch {
      sendLiveStopBeacon(state.ticker);
    } finally {
      state.tickerHeaderLive = false;
      state.tickerHeaderLiveMode = null;
      state.tickerHeaderLiveWarning = null;
      updateTickerHeaderPrice();
    }
  }

  if (shouldAuto || state.chartLive || state.chartLivePendingStart || state.tickerHeaderLive) {
    startChartLiveRefresh();
  } else {
    stopChartLiveRefresh();
  }
}

function shouldKeepTickerLiveSession() {
  return Boolean(
    shouldAutoTickerHeaderLive() ||
    state.tickerHeaderLive ||
    state.tickerHeaderLivePending
  );
}

async function stopTickerPageLiveSession() {
  const ticker = state.ticker;
  const hasSession = state.chartLive || state.chartLivePendingStart || state.tickerHeaderLive || state.tickerHeaderLivePending;
  state.chartLivePendingStart = false;
  state.chartLive = false;
  state.chartLiveTicker = null;
  state.chartLiveMode = null;
  state.chartLiveWarning = null;
  state.chartLiveQuote = null;
  state.tickerHeaderLivePending = false;
  state.tickerHeaderLive = false;
  state.tickerHeaderLiveMode = null;
  state.tickerHeaderLiveWarning = null;
  stopChartLiveRefresh();
  updateLiveButtonState();
  updateTickerHeaderPrice();

  if (ticker && hasSession) {
    try {
      const response = await fetch("/api/live/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    } catch {
      sendLiveStopBeacon(ticker);
    }
  }
}

function formatAnalysisSpanOption(pattern, index) {
  const label = pattern?.title || pattern?.labels?.join(" / ") || `Span ${index + 1}`;
  const range = pattern?.startDate && pattern?.endDate
    ? ` (${pattern.startDate} → ${pattern.endDate})`
    : "";
  return `${index + 1}. ${label}${range}`;
}

function renderChartAnalysis(payload) {
  const panel = $("#chart-analysis-panel");
  const body = $("#chart-analysis-body");
  const meta = $("#chart-analysis-meta");
  if (!panel || !body || !meta) return;
  const patterns = payload?.patterns || [];
  const selectedIndex = Math.min(
    Math.max(0, state.chartAnalysisSelectedIndex || 0),
    Math.max(0, patterns.length - 1)
  );
  state.chartAnalysisSelectedIndex = patterns.length ? selectedIndex : 0;
  panel.classList.remove("hidden");
  meta.textContent = payload?.window
    ? `${payload.window.rows} rows · ${payload.window.period || "current"} · ${payload.window.interval || "1d"}`
    : "";

  const queries = payload?.queries || [];
  const response = payload?.response || "No analysis returned.";

  body.innerHTML = `
    ${patterns.length ? `
      <section class="chart-analysis-section">
        <div class="chart-analysis-nav">
          <div>
            <h3>Patterns</h3>
            <div class="chart-analysis-text">Jump to a detected span and focus the matching chart region.</div>
          </div>
          <label class="chart-analysis-select-wrap">
            <span>Jump to span</span>
            <select id="chart-analysis-span-select" class="chart-analysis-select">
              ${patterns.map((pattern, index) => `
                <option value="${index}" ${index === selectedIndex ? "selected" : ""}>
                  ${escapeHtml(formatAnalysisSpanOption(pattern, index))}
                </option>
              `).join("")}
            </select>
          </label>
        </div>
        <div class="chart-analysis-patterns">
          ${patterns.map((pattern, index) => `
            <div class="chart-analysis-pattern ${index === selectedIndex ? "active" : ""}" data-chart-span="${index}">
              <strong>${escapeHtml(pattern.title || "Pattern")}</strong>
              <div class="chart-analysis-text">${escapeHtml(pattern.details || "")}</div>
              <small>${escapeHtml((pattern.labels || []).join(" · ") || "Pattern")} · ${escapeHtml(pattern.startDate || "—")} to ${escapeHtml(pattern.endDate || "—")} · Score ${Number(pattern.score || 0).toFixed(2)}</small>
            </div>
          `).join("")}
        </div>
      </section>` : ""}
    ${queries.length ? `
      <section class="chart-analysis-section">
        <h3>Web Search</h3>
        <div class="chart-analysis-text">${escapeHtml(queries.map((item) => `${item.query}: ${item.results?.length || 0} result(s)`).join("\n"))}</div>
      </section>` : ""}
    <section class="chart-analysis-section">
      <h3>LLM Readout</h3>
      <div class="chart-analysis-text">${renderMarkdown(response)}</div>
    </section>
  `;

  const select = $("#chart-analysis-span-select");
  if (select) {
    select.value = String(selectedIndex);
    select.onchange = () => {
      state.chartAnalysisSelectedIndex = Number(select.value) || 0;
      rerenderCurrentTickerChart();
      renderChartAnalysis(state.chartAnalysis || payload);
      $("#ticker-chart-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }
}

async function runChartAnalysis() {
  const ticker = state.ticker;
  if (!ticker || !state.chartRows.length || state.compareTickers.length > 0) return;
  const panel = $("#chart-analysis-panel");
  const body = $("#chart-analysis-body");
  const meta = $("#chart-analysis-meta");
  const btn = $("#chart-analyze-btn");
  if (!panel || !body || !meta || !btn) return;

  state.chartAnalysisLoading = true;
  updateAnalyzeButtonState();
  panel.classList.remove("hidden");
  meta.textContent = "Analyzing…";
  body.innerHTML = `<div class="chart-empty">Scanning candles, searching the web, and summarizing with llama.cpp…</div>`;

  try {
    const data = await post("/api/analyze-candles", {
      ticker,
      assetType: state.assetType,
      period: state.chartPeriod,
      interval: state.chartInterval,
      rows: state.chartRows,
      provider: "llama",
      llamaUrl: loadLlmSettings().serverUrl,
    });
    state.chartAnalysis = data;
    state.chartAnalysisSelectedIndex = 0;
    renderChartAnalysis(data);
    rerenderCurrentTickerChart();
  } catch (error) {
    body.innerHTML = `<div class="chart-empty">${escapeHtml(error.message)}</div>`;
    meta.textContent = "Analysis failed";
  } finally {
    state.chartAnalysisLoading = false;
    updateAnalyzeButtonState();
  }
}

function startChartLiveRefresh() {
  if (state.chartLiveTimer) return;
  state.chartLiveTimer = setInterval(() => {
    if (state.route !== "ticker") return;
    if (state.chartLive || state.chartLivePendingStart) {
      if (state.tickerMainTab === "chart") void runTickerChart();
      else void refreshTickerHeaderLive();
      return;
    }
    if (shouldAutoTickerHeaderLive()) {
      void refreshTickerHeaderLive();
    }
  }, 10000);
}

function stopChartLiveRefresh() {
  if (!state.chartLiveTimer) return;
  clearInterval(state.chartLiveTimer);
  state.chartLiveTimer = null;
}

function sendLiveStopBeacon(ticker) {
  if (!ticker || !navigator.sendBeacon) return false;
  try {
    const body = new Blob([JSON.stringify({ ticker })], { type: "application/json" });
    return navigator.sendBeacon("/api/live/stop", body);
  } catch {
    return false;
  }
}

async function startChartLive() {
  const ticker = state.ticker;
  if (!ticker || state.compareTickers.length > 0) return;
  if (state.chartLive) return;
  state.chartLivePendingStart = true;
  updateLiveButtonState();
  state.chartLive = true;
  state.chartLiveTicker = ticker;
  state.chartLiveMode = "poll";
  state.chartLiveWarning = null;
  state.chartLiveQuote = null;
  state.chartLivePendingStart = false;
  startChartLiveRefresh();
  updateLiveButtonState();
  updateAnalyzeButtonState();
  void runTickerChart();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("/api/live/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    if (state.chartLiveTicker === ticker) {
      state.chartLiveMode = data?.mode || state.chartLiveMode || "socket";
      state.chartLiveWarning = data?.warning || null;
      updateLiveButtonState();
    }
  } catch (error) {
    if (state.chartLiveTicker === ticker) {
      state.chartLiveMode = "poll";
      state.chartLiveWarning = error?.message || "Live socket unavailable; using candle polling.";
      updateLiveButtonState();
    }
  }
}

async function stopChartLive(restoreRange = true) {
  const ticker = state.chartLiveTicker || state.ticker;
  const wasLive = state.chartLive || state.chartLivePendingStart;
  const keepSession = shouldKeepTickerLiveSession();
  state.chartLivePendingStart = false;
  state.chartLive = false;
  state.chartLiveTicker = null;
  state.chartLiveMode = null;
  state.chartLiveWarning = null;
  state.chartLiveQuote = null;
  updateLiveButtonState();
  updateAnalyzeButtonState();

  if (ticker && !keepSession) {
    try {
      const response = await fetch("/api/live/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    } catch {
      sendLiveStopBeacon(ticker);
    }
  }

  await syncTickerHeaderLive();

  if (restoreRange && wasLive) {
    state.chartPeriod = state.chartLivePrevPeriod || state.chartPeriod || "1mo";
    state.chartInterval = state.chartLivePrevInterval || state.chartInterval || "1d";
    $$(".chart-range").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.period === state.chartPeriod && btn.dataset.interval === state.chartInterval
      );
    });
    await runTickerChart();
  }
}

function renderMarkdown(text) {
  if (!text || typeof globalThis.marked === "undefined") return text || "";
  return globalThis.marked.parse(text, { breaks: true, gfm: true });
}

function renderStreamingMarkdown(bubbleEl, content) {
  if (!bubbleEl) return;
  const cursor = bubbleEl.querySelector(".llm-cursor");
  if (cursor) cursor.remove();
  bubbleEl.innerHTML = renderMarkdown(content);
  const newCursor = document.createElement("span");
  newCursor.className = "llm-cursor";
  bubbleEl.appendChild(newCursor);
}

async function fetchWebContext(query) {
  try {
    const res = await fetch(`/api/web-search?q=${encodeURIComponent(query)}&max=5`);
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || !results.length) return null;
    const lines = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`
    );
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `[Today's date: ${today}]\n\n[Web search results for: "${query}"]\n\n${lines.join("\n\n")}`;
  } catch {
    return null;
  }
}

function loadChatConversations() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
  } catch { return []; }
}

function saveChatConversations(convs) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(convs));
  } catch (err) {
    setStatus("Chat storage full — delete some conversations.", true);
  }
}

function loadChatSettings() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) || "{}");
  } catch { return {}; }
}

function saveChatSettings(settings) {
  const current = loadChatSettings();
  localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

function loadChatResearchEffort() {
  const effort = localStorage.getItem(CHAT_RESEARCH_EFFORT_KEY) || "default";
  return ["default", "high", "extreme"].includes(effort) ? effort : "default";
}

function saveChatResearchEffort(effort) {
  const normalized = ["default", "high", "extreme"].includes(effort)
    ? effort
    : "default";
  localStorage.setItem(CHAT_RESEARCH_EFFORT_KEY, normalized);
  state.chatResearchEffort = normalized;
}

function createConversation(provider = "claude") {
  const settings = loadChatSettings();
  const model = provider === "claude"
    ? (settings.claudeModel || "claude-sonnet-4-6")
    : provider === "openai"
      ? (settings.openaiModel || "gpt-4o")
      : null;
  const conv = {
    id: crypto.randomUUID(),
    title: "New conversation",
    provider,
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.chatConversations.unshift(conv);
  saveChatConversations(state.chatConversations);
  return conv;
}

function getActiveConversation() {
  return state.chatConversations.find((c) => c.id === state.chatActiveId) || null;
}

function updateConversation(id, changes) {
  const conv = state.chatConversations.find((c) => c.id === id);
  if (!conv) return;
  Object.assign(conv, changes, { updatedAt: Date.now() });
  state.chatConversations.sort((a, b) => b.updatedAt - a.updatedAt);
  saveChatConversations(state.chatConversations);
}

function deleteConversation(id) {
  state.chatConversations = state.chatConversations.filter((c) => c.id !== id);
  saveChatConversations(state.chatConversations);
  if (state.chatActiveId === id) {
    state.chatActiveId = state.chatConversations[0]?.id || null;
    renderChatMessages();
    renderChatToolbar();
  }
  renderChatSidebar();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function renderChatSidebar() {
  const list = $("#chat-conv-list");
  if (!list) return;
  if (!state.chatConversations.length) {
    list.innerHTML = '<div class="chat-conv-empty">No conversations yet.</div>';
    return;
  }
  list.innerHTML = state.chatConversations
    .map(
      (conv) => `
    <div class="chat-conv-item${conv.id === state.chatActiveId ? " active" : ""}"
         data-conv-id="${conv.id}">
      <div class="chat-conv-title">${escapeHtml(conv.title)}</div>
      <div class="chat-conv-meta">${escapeHtml(conv.provider)} · ${timeAgo(conv.updatedAt)}</div>
      <button class="chat-conv-delete" data-conv-delete="${conv.id}"
              type="button" aria-label="Delete conversation">×</button>
    </div>`
    )
    .join("");
  list.querySelectorAll("[data-conv-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-conv-delete]")) return;
      openConversation(el.dataset.convId);
    });
  });
  list.querySelectorAll("[data-conv-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(btn.dataset.convDelete);
    });
  });
}

function appendChatMessage(role, content, streaming = false, provider = null) {
  const area = $("#chat-messages");
  if (!area) return null;
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  const roleEl = document.createElement("span");
  roleEl.className = "chat-msg-role";
  roleEl.textContent = role === "user" ? "You" : role === "error" ? "Error" : (provider || "Assistant");
  const metaEl = document.createElement("div");
  metaEl.className = "chat-msg-meta hidden";
  const bubble = document.createElement("div");
  bubble.className = "chat-msg-bubble";
  if (streaming || role !== "assistant") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "llm-cursor";
    bubble.appendChild(cursor);
  }
  div.appendChild(roleEl);
  div.appendChild(metaEl);
  div.appendChild(bubble);
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return bubble;
}

function setChatMessageMeta(bubbleEl, text) {
  const metaEl = bubbleEl?.closest(".chat-msg")?.querySelector(".chat-msg-meta");
  if (!metaEl) return;
  const cleaned = String(text || "").trim();
  metaEl.textContent = cleaned;
  metaEl.classList.toggle("hidden", !cleaned);
}

function formatToolCallLabel(call) {
  const raw = String(call || "").trim();
  const label = raw.replace(/\(.*$/, "").replace(/^get_/, "").replace(/_/g, " ").trim();
  return label || raw;
}

function summarizeToolCalls(toolCalls) {
  const labels = [...new Set((toolCalls || []).map(formatToolCallLabel).filter(Boolean))];
  if (!labels.length) return "";
  return `Using local tools: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` +${labels.length - 3}` : ""}`;
}

function renderChatMessages() {
  const area = $("#chat-messages");
  if (!area) return;
  const conv = getActiveConversation();
  const inputEl = $("#chat-input");
  const sendEl = $("#chat-send");
  if (!conv) {
    area.innerHTML = `
      <div class="chat-empty-state" id="chat-empty-state">
        <p>No conversation selected.</p>
        <button class="secondary" id="chat-empty-new" type="button">+ New conversation</button>
      </div>`;
    $("#chat-empty-new")?.addEventListener("click", () => {
      const c = createConversation(defaultChatProvider());
      openConversation(c.id);
      renderChatSidebar();
    });
    if (inputEl) inputEl.disabled = true;
    if (sendEl) sendEl.disabled = true;
    const webToggle = $("#chat-web-toggle");
    if (webToggle) webToggle.disabled = true;
    const deepToggle = $("#chat-deep-toggle");
    if (deepToggle) deepToggle.disabled = true;
    return;
  }
  area.innerHTML = "";
  const webToggle = $("#chat-web-toggle");
  if (webToggle) webToggle.disabled = false;
  const deepToggle = $("#chat-deep-toggle");
  if (deepToggle) deepToggle.disabled = false;
  conv.messages.forEach((msg) =>
    appendChatMessage(msg.role, msg.content, false, msg.provider)
  );
  area.scrollTop = area.scrollHeight;
  if (inputEl) inputEl.disabled = false;
  if (sendEl) sendEl.disabled = false;
}

function renderChatToolbar() {
  const titleEl = $("#chat-conv-title");
  const providerBtn = $("#chat-provider-btn");
  const effortWrap = $("#chat-effort-wrap");
  const effortSelect = $("#chat-effort-select");
  const conv = getActiveConversation();
  if (!titleEl || !providerBtn) return;
  if (!conv) {
    titleEl.textContent = "";
    providerBtn.textContent = "— ▾";
    providerBtn.disabled = true;
    effortWrap?.classList.add("hidden");
    return;
  }
  titleEl.textContent = conv.title;
  const modelShort = conv.model
    ? conv.model.split("-").slice(0, 3).join("-")
    : "";
  providerBtn.textContent = modelShort
    ? `${conv.provider} · ${modelShort} ▾`
    : `${conv.provider} ▾`;
  providerBtn.disabled = false;
  if (effortSelect) effortSelect.value = state.chatResearchEffort || "default";
  effortWrap?.classList.toggle("hidden", !state.chatDeepResearch);
}

function defaultChatProvider() {
  if (state.chatProviders.claude) return "claude";
  if (state.chatProviders.openai) return "openai";
  return "llama";
}

function openConversation(id) {
  state.chatActiveId = id;
  renderChatSidebar();
  renderChatMessages();
  renderChatToolbar();
  $("#chat-input")?.focus();
}

function getChatAutocompleteState() {
  if (!window.__chatAutocompleteState) {
    window.__chatAutocompleteState = {
      requestId: 0,
      items: [],
      range: null,
      timer: null,
      visible: false,
      activeIndex: 0,
    };
  }
  return window.__chatAutocompleteState;
}

function hideChatAutocomplete() {
  const popup = $("#chat-autocomplete");
  if (popup) popup.classList.add("hidden");
  const stateObj = getChatAutocompleteState();
  stateObj.visible = false;
  stateObj.items = [];
  stateObj.range = null;
  stateObj.activeIndex = 0;
}

function renderChatAutocomplete(items, range, activeIndex = 0) {
  const popup = $("#chat-autocomplete");
  if (!popup) return;
  const stateObj = getChatAutocompleteState();
  stateObj.items = items;
  stateObj.range = range;
  stateObj.activeIndex = activeIndex;
  stateObj.visible = items.length > 0;

  if (!items.length) {
    popup.innerHTML = "";
    popup.classList.add("hidden");
    return;
  }

  popup.innerHTML = items
    .map((item, index) => `
      <button
        class="chat-autocomplete-item${index === activeIndex ? " active" : ""}"
        type="button"
        data-chat-autocomplete-index="${index}"
        data-chat-autocomplete-value="${escapeHtml(item.insert)}"
        data-chat-autocomplete-start="${range.start}"
        data-chat-autocomplete-end="${range.end}"
        role="option"
        aria-selected="${index === activeIndex ? "true" : "false"}"
      >
        <span class="chat-autocomplete-label">${escapeHtml(item.label)}</span>
        <span class="chat-autocomplete-hint">${escapeHtml(item.hint || item.insert)}</span>
      </button>
    `)
    .join("");
  popup.classList.remove("hidden");
}

function applyChatAutocompleteItem(item, range) {
  const input = $("#chat-input");
  if (!input || !range || !item) return;
  const before = input.value.slice(0, range.start);
  const after = input.value.slice(range.end);
  const insert = item.insert.endsWith(" ") ? item.insert : `${item.insert} `;
  input.value = `${before}${insert}${after}`;
  const caret = before.length + insert.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  hideChatAutocomplete();
  updateChatInputHeight();
  void refreshChatAutocomplete();
}

function updateChatInputHeight() {
  const ta = $("#chat-input");
  if (!ta) return;
  ta.style.height = "38px";
  ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
}

function getChatTokenAtCursor(text, caret) {
  const before = text.slice(0, caret);
  const start = Math.max(
    before.lastIndexOf(" "),
    before.lastIndexOf("\n"),
    before.lastIndexOf("\t")
  ) + 1;
  const token = before.slice(start);
  if (!token.startsWith("@")) return null;
  return { start, end: caret, token };
}

function splitTickerQuery(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function tickerContextSummary(info, ticker) {
  const parts = [];
  const name = info.shortName || info.longName || info.displayName || info.name || ticker;
  parts.push(`Ticker: ${ticker}`);
  if (name) parts.push(`Name: ${name}`);
  if (info.assetType) parts.push(`Asset type: ${info.assetType}`);
  if (info.exchange) parts.push(`Exchange: ${info.exchange}`);
  if (info.sector) parts.push(`Sector: ${info.sector}`);
  if (info.industry) parts.push(`Industry: ${info.industry}`);
  if (info.marketCap != null) parts.push(`Market cap: ${formatValue(info.marketCap)}`);
  if (info.currentPrice != null) parts.push(`Current price: ${formatValue(info.currentPrice)}`);
  if (info.regularMarketPrice != null && info.currentPrice == null) {
    parts.push(`Current price: ${formatValue(info.regularMarketPrice)}`);
  }
  if (info.trailingPE != null) parts.push(`Trailing P/E: ${formatValue(info.trailingPE)}`);
  if (info.forwardPE != null) parts.push(`Forward P/E: ${formatValue(info.forwardPE)}`);
  if (info.dividendYield != null) parts.push(`Dividend yield: ${formatValue(info.dividendYield)}`);
  if (info.ceo) parts.push(`CEO: ${info.ceo}`);
  if (info.longBusinessSummary) parts.push(`Summary: ${String(info.longBusinessSummary).trim()}`);
  return parts.join("\n");
}

function marketCommandSummary(command, payload) {
  if (!payload) return "";
  if (command.startsWith("macro/")) {
    const rows = payload?.data?.rows || [];
    const columns = payload?.data?.columns || [];
    const xCol = payload?.x_column || "observation_date";
    const lines = [
      `Title: ${payload.title || command}`,
      `Rows: ${rows.length}`,
      `Latest date: ${rows[0]?.[xCol] || "—"}`,
    ];
    const seriesCols = (payload?.chart_columns || []).filter((column) => columns.includes(column)).slice(0, 3);
    if (seriesCols.length && rows.length) {
      lines.push("Latest values:");
      seriesCols.forEach((column) => {
        lines.push(`- ${column}: ${formatValue(rows[0]?.[column])}`);
      });
    }
    if (rows.length > 1) {
      lines.push("Recent rows:");
      rows.slice(0, 3).forEach((row, index) => {
        const bits = [row[xCol], ...seriesCols.map((column) => `${column}=${formatValue(row?.[column])}`)].filter(Boolean);
        lines.push(`${index + 1}. ${bits.join(" · ")}`);
      });
    }
    return lines.join("\n");
  }

  if (command.startsWith("prediction/")) {
    const events = payload?.events || [];
    const counts = payload?.counts || {};
    const lines = [
      `Title: Prediction Markets`,
      `Tab: ${command.split("/")[1] || "all"}`,
      `Events: ${events.length}`,
      `Open markets: ${payload?.totals?.markets ?? 0}`,
    ];
    if (counts && typeof counts === "object") {
      const topCounts = Object.entries(counts)
        .filter(([key]) => key !== "all")
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 4);
      if (topCounts.length) {
        lines.push("Category counts:");
        topCounts.forEach(([key, value]) => lines.push(`- ${key}: ${value}`));
      }
    }
    if (events.length) {
      lines.push("Top events:");
      events.slice(0, 3).forEach((event, index) => {
        lines.push(
          `${index + 1}. ${event.title || event.event_ticker} · ${event.category || event.category_key || "Other"} · `
          + `${event.markets_count || 0} markets · ${formatValue(event.total_volume_fp || 0)} volume`
        );
      });
    }
    return lines.join("\n");
  }

  const data = payload?.data || payload;
  const rows = data?.rows || [];
  const columns = data?.columns || [];
  const lines = [
    `Title: ${payload.title || command}`,
    `Rows: ${rows.length}`,
  ];
  if (!rows.length || !columns.length) return lines.join("\n");

  const usefulCols = ["symbol", "name", "price", "change %", "change", "volume", "market cap", "sector"]
    .map((column) => columns.find((item) => String(item).toLowerCase() === column))
    .filter(Boolean);
  const displayCols = usefulCols.length ? usefulCols : columns.slice(0, Math.min(columns.length, 4));
  lines.push("Top rows:");
  rows.slice(0, 3).forEach((row, index) => {
    const bits = displayCols.map((column) => `${column}=${formatValue(row?.[column])}`).filter(Boolean);
    lines.push(`${index + 1}. ${bits.join(" · ")}`);
  });
  return lines.join("\n");
}

function normalizeMarketCommand(command) {
  return String(command || "")
    .trim()
    .replace(/^@markets\/?/, "")
    .toLowerCase();
}

function isPredictionMarketTab(key) {
  return new Set(["all", "sports", "crypto", "politics", "economics", "weather", "technology", "entertainment", "energy", "other"]).has(key);
}

function isMacroTab(key) {
  return new Set(["gdp", "cpi", "pce", "labor", "unemployment", "treasury", "fed_funds", "credit", "liquidity", "housing", "consumer"]).has(key);
}

function buildMarketAutocompleteItems(token) {
  const normalized = token.toLowerCase();
  if (!normalized.startsWith("@markets")) return [];
  const query = normalized.replace(/^@markets\/?/, "");
  const base = CHAT_MARKET_COMMANDS;
  if (!query) return base.slice(0, CHAT_AUTOCOMPLETE_LIMIT);

  return base.filter((item) => {
    const insert = item.insert.toLowerCase();
    const label = item.label.toLowerCase();
    return insert.includes(normalized) || insert.startsWith(`@markets/${query}`) || label.includes(query);
  }).slice(0, CHAT_AUTOCOMPLETE_LIMIT);
}

function isMarketAutocompleteTrigger(token) {
  const normalized = token.toLowerCase();
  return normalized === "@m"
    || normalized === "@ma"
    || normalized === "@mar"
    || normalized === "@mark"
    || normalized === "@marke"
    || normalized === "@market"
    || normalized.startsWith("@markets");
}

async function fetchMarketContext(command) {
  const normalized = normalizeMarketCommand(command);
  if (!normalized) return null;
  const cacheKey = `market:${normalized}`;
  const cached = state.chatContextCache?.get(cacheKey);
  if (cached) return cached;

  let data = null;
  if (normalized.startsWith("macro/")) {
    const tab = normalized.split("/")[1];
    if (!isMacroTab(tab)) return null;
    const response = await fetch(`/api/macro?tab=${encodeURIComponent(tab)}`);
    data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  } else if (normalized.startsWith("prediction/")) {
    const tab = normalized.split("/")[1];
    if (!isPredictionMarketTab(tab)) return null;
    const params = new URLSearchParams({
      limit: "100",
      status: "open",
      with_nested_markets: "true",
      with_milestones: "true",
    });
    const response = await fetch(`/api/kalshi/events?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Request failed.");
    const targetKey = tab;
    const events = (payload.events || [])
      .map((event) => ({
        ...event,
        category_key: normalizePredictionCategory(`${event.title || ""} ${event.sub_title || ""} ${event.category || ""}`),
      }))
      .filter((event) => targetKey === "all" || event.category_key === targetKey);
    data = {
      title: "Prediction Markets",
      events,
      totals: { markets: events.reduce((sum, event) => sum + (event.markets || []).length, 0) },
      counts: events.reduce((acc, event) => {
        acc[event.category_key] = (acc[event.category_key] || 0) + 1;
        acc.all = (acc.all || 0) + 1;
        return acc;
      }, {}),
    };
  } else {
    const sub = normalized;
    const response = await fetch(`/api/markets?sub=${encodeURIComponent(sub)}`);
    data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  }

  if (!state.chatContextCache) state.chatContextCache = new Map();
  state.chatContextCache.set(cacheKey, data);
  return data;
}

function normalizePredictionCategory(text) {
  const lower = String(text || "").toLowerCase();
  const pairs = [
    ["sports", ["sport", "nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "hockey", "golf", "tennis", "olympic", "world cup", "f1"]],
    ["crypto", ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "dogecoin", "doge", "blockchain", "stablecoin", "altcoin"]],
    ["politics", ["politic", "election", "president", "white house", "congress", "senate", "house", "campaign", "trump", "biden", "harris", "democrat", "republican", "governor", "supreme court"]],
    ["economics", ["inflation", "cpi", "pce", "fed", "fomc", "rate", "rates", "gdp", "recession", "jobs", "jobless", "unemployment", "treasury", "yield", "macro", "economic", "employment", "payroll"]],
    ["weather", ["weather", "hurricane", "storm", "snow", "rain", "temperature", "climate", "heat", "flood", "tornado", "wildfire", "forecast", "blizzard"]],
    ["technology", ["technology", "tech", "ai", "artificial intelligence", "semiconductor", "chip", "chips", "nvidia", "apple", "microsoft", "google", "openai", "software", "internet", "cloud", "hardware"]],
    ["entertainment", ["entertainment", "movie", "film", "box office", "music", "tv", "television", "celebrity", "oscars", "grammy", "streaming", "netflix", "disney"]],
    ["energy", ["energy", "oil", "gas", "gasoline", "opec", "crude", "petroleum", "wti", "brent", "renewable", "solar", "wind", "power"]],
  ];
  for (const [key, hints] of pairs) {
    if (hints.some((hint) => lower.includes(hint))) return key;
  }
  return "other";
}

async function fetchTickerContext(ticker) {
  const normalized = String(ticker || "").trim().toUpperCase();
  if (!normalized) return null;
  const cacheKey = `ticker:${normalized}`;
  const cached = state.chatContextCache?.get(cacheKey);
  if (cached) return cached;
  const response = await fetch(`/api/ticker-info?ticker=${encodeURIComponent(normalized)}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  if (!state.chatContextCache) state.chatContextCache = new Map();
  state.chatContextCache.set(cacheKey, data);
  return data;
}

function formatChatContextBlock(token, lines) {
  return [`[Context: ${token}]`, ...lines.filter(Boolean)].join("\n");
}

async function buildChatContextMessage(text) {
  const tokenPattern = /@(tickers|markets)\/([A-Za-z0-9.\-_,\/]+)/g;
  const tokens = [];
  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    tokens.push({
      token: match[0],
      type: match[1],
      body: match[2],
      start: match.index,
      end: tokenPattern.lastIndex,
    });
  }
  if (!tokens.length) {
    return { text, contexts: [] };
  }

  const contexts = [];
  const cleanedParts = [];
  let cursor = 0;
  for (const token of tokens) {
    cleanedParts.push(text.slice(cursor, token.start));
    cursor = token.end;
    if (token.type === "tickers") {
      const tickers = splitTickerQuery(token.body).slice(0, 5);
      const summaries = [];
      for (const ticker of tickers) {
        try {
          const info = await fetchTickerContext(ticker);
          if (!info) continue;
          summaries.push(tickerContextSummary(info, ticker));
        } catch (error) {
          summaries.push(`Ticker: ${ticker}\nError: ${error.message}`);
        }
      }
      if (summaries.length) {
        contexts.push(formatChatContextBlock(token.token, summaries));
      }
    } else if (token.type === "markets") {
      try {
        const data = await fetchMarketContext(token.body);
        if (data) {
          const summary = marketCommandSummary(token.body, data);
          if (summary) contexts.push(formatChatContextBlock(token.token, [summary]));
        }
      } catch (error) {
        contexts.push(formatChatContextBlock(token.token, [`Error: ${error.message}`]));
      }
    }
  }
  cleanedParts.push(text.slice(cursor));

  const cleaned = cleanedParts.join("").replace(/\s{2,}/g, " ").trim();
  return { text: cleaned || text.trim(), contexts };
}

function formatChatAutocompleteItems(token, tickers, query) {
  const items = [];
  const normalizedToken = token.toLowerCase();
  if (normalizedToken === "@" || normalizedToken === "@t" || normalizedToken === "@ti" || normalizedToken === "@tick" || normalizedToken === "@ticke" || normalizedToken === "@ticker" || normalizedToken === "@tickers" || normalizedToken === "@tickers/") {
    items.push(...CHAT_COMMANDS.map((cmd) => ({
      label: cmd.label,
      hint: cmd.hint,
      insert: cmd.token,
    })));
    return items;
  }

  if (isMarketAutocompleteTrigger(normalizedToken)) {
    const marketItems = buildMarketAutocompleteItems(normalizedToken);
    if (marketItems.length) {
      items.push(...marketItems);
      return items;
    }
  }

  if (normalizedToken.startsWith("@tickers/")) {
    const q = String(query || "").trim().toUpperCase();
    if (!tickers.length && q.length < 1) {
      items.push({
        label: "Type a ticker symbol",
        hint: "@tickers/AAPL",
        insert: "@tickers/AAPL",
      });
      return items;
    }
    tickers.slice(0, CHAT_AUTOCOMPLETE_LIMIT).forEach((item) => {
      items.push({
        label: `${item.ticker} · ${item.name || "Ticker"}`,
        hint: item.ticker,
        insert: `@tickers/${item.ticker}`,
      });
    });
  }

  return items;
}

async function refreshChatAutocomplete() {
  const input = $("#chat-input");
  const popup = $("#chat-autocomplete");
  if (!input || !popup || input.disabled) return;

  const tokenInfo = getChatTokenAtCursor(input.value, input.selectionStart ?? input.value.length);
  if (!tokenInfo) {
    hideChatAutocomplete();
    return;
  }

  const normalized = tokenInfo.token.toLowerCase();
  const requestId = (getChatAutocompleteState().requestId += 1);

  if (normalized.startsWith("@tickers/")) {
    const query = normalized.slice("@tickers/".length).trim();
    if (!query) {
      renderChatAutocomplete(formatChatAutocompleteItems(tokenInfo.token, [], query), tokenInfo);
      return;
    }
    try {
      const results = await fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json());
      if (requestId !== getChatAutocompleteState().requestId) return;
      const items = formatChatAutocompleteItems(tokenInfo.token, results || [], query);
      if (items.length) renderChatAutocomplete(items, tokenInfo);
      else hideChatAutocomplete();
    } catch {
      hideChatAutocomplete();
    }
    return;
  }

  if (normalized.startsWith("@markets")) {
    const items = formatChatAutocompleteItems(tokenInfo.token, [], "");
    if (items.length) renderChatAutocomplete(items, tokenInfo);
    else hideChatAutocomplete();
    return;
  }

  const items = formatChatAutocompleteItems(tokenInfo.token, [], "");
  if (items.length) renderChatAutocomplete(items, tokenInfo);
  else hideChatAutocomplete();
}

async function streamChatResponse(messages, provider, model, bubbleEl) {
  let url, bodyObj;
  const headers = { "content-type": "application/json" };

  if (provider === "llama") {
    const { serverUrl } = loadLlmSettings();
    url = "/api/chat/llama";
    bodyObj = {
      model: "local",
      messages,
      stream: true,
      llamaUrl: serverUrl || "http://localhost:8080",
    };
  } else {
    url = `/api/chat/${provider}`;
    bodyObj = { messages, model, stream: true };
  }

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyObj) });
  } catch (err) {
    return { content: "", error: "Could not reach server. Check settings." };
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch { }
    return { content: "", error: errMsg, toolCalls: [] };
  }

  let toolCalls = [];
  try {
    const rawToolCalls = res.headers.get("x-stocklens-tool-calls");
    if (rawToolCalls) toolCalls = JSON.parse(rawToolCalls);
  } catch { }
  if (toolCalls.length) {
    setChatMessageMeta(bubbleEl, summarizeToolCalls(toolCalls));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break outer;
      try {
        const obj = JSON.parse(raw);
        const token = obj.choices?.[0]?.delta?.content;
        if (token) {
          content += token;
          renderStreamingMarkdown(bubbleEl, content);
          bubbleEl.closest("#chat-messages")?.scrollTo(0, 999999);
        }
      } catch { }
    }
  }

  reader.cancel();
  bubbleEl.innerHTML = renderMarkdown(content);
  return { content, error: null, toolCalls };
}

async function sendDeepResearch() {
  const input = $("#chat-input");
  const text = input?.value.trim();
  const conv = getActiveConversation();
  if (!text || !conv || state.chatStreaming) return;

  const { provider, model } = conv;
  const llamaUrl = provider === "llama" ? (loadLlmSettings().serverUrl || "http://localhost:8080") : undefined;
  const effort = ["high", "extreme"].includes(state.chatResearchEffort)
    ? state.chatResearchEffort
    : "default";

  state.chatStreaming = true;
  input.value = "";
  input.style.height = "38px";
  $("#chat-send")?.setAttribute("disabled", "");

  const isFirstAssistant = !conv.messages.some((m) => m.role === "assistant");
  const { text: cleanedText, contexts } = await buildChatContextMessage(text);
  conv.messages.push({ role: "user", content: text, timestamp: Date.now() });
  updateConversation(conv.id, {});
  appendChatMessage("user", text);

  // Build research progress card
  const area = $("#chat-messages");
  const progressMsgDiv = document.createElement("div");
  progressMsgDiv.className = "chat-msg assistant";
  const progressRoleEl = document.createElement("span");
  progressRoleEl.className = "chat-msg-role";
  progressRoleEl.textContent = provider || "Assistant";
  const progressMetaEl = document.createElement("div");
  progressMetaEl.className = "chat-msg-meta hidden";
  const progressCard = document.createElement("div");
  progressCard.className = "research-progress";
  progressCard.innerHTML = `<div class="research-header">🔬 Deep Research</div><div class="research-phase">Planning…</div>`;
  progressMsgDiv.appendChild(progressRoleEl);
  progressMsgDiv.appendChild(progressMetaEl);
  progressMsgDiv.appendChild(progressCard);
  area.appendChild(progressMsgDiv);
  area.scrollTop = area.scrollHeight;

  const apiMessages = conv.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
  if (apiMessages.length) {
    const promptParts = [];
    if (contexts.length) promptParts.push(...contexts);
    if (promptParts.length) {
      apiMessages[apiMessages.length - 1] = {
        role: "user",
        content: `${promptParts.join("\n\n---\n\n")}\n\n---\n\n${cleanedText}`,
      };
    }
  }

  let content = "";
  let isClarification = false;
  let queries = [];
  const queryStatus = {};
  let answerBubble = null; // created via appendChatMessage when synthesizing starts

  function redrawProgress() {
    let html = `<div class="research-header">🔬 Deep Research</div>`;
    const phaseText = progressCard.dataset.phase || "Planning…";
    html += `<div class="research-phase">${phaseText}</div>`;
    if (queries.length) {
      html += `<ul class="research-query-list">`;
      for (const q of queries) {
        const s = queryStatus[q] || "pending";
        const icon = s === "done" ? "✓" : s === "active" ? "⟳" : "○";
        const cls = s === "done" ? "done" : s === "active" ? "active" : "";
        html += `<li class="research-query-item"><em class="research-q-icon ${cls}">${icon}</em><span>${q}</span></li>`;
      }
      html += `</ul>`;
    }
    progressCard.innerHTML = html;
  }

  function setPhase(text) {
    progressCard.dataset.phase = text;
    redrawProgress();
  }

  try {
    const res = await fetch("/api/chat/deep-research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, provider, model, effort, ...(llamaUrl && { llamaUrl }) }),
    });
    if (!res.ok) {
      progressMsgDiv.remove();
      appendChatMessage("error", `⚠ HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") break outer;
        try {
          const evt = JSON.parse(raw);
          switch (evt.type) {
            case "status":
              setPhase(evt.text);
              break;
            case "tool_context":
              progressMetaEl.textContent = summarizeToolCalls(evt.tool_calls || []);
              progressMetaEl.classList.toggle("hidden", !progressMetaEl.textContent.trim());
              break;
            case "plan":
              queries = evt.queries;
              for (const q of queries) queryStatus[q] = "pending";
              setPhase("Searching the web…");
              break;
            case "searching":
              queryStatus[evt.query] = "active";
              redrawProgress();
              break;
            case "search_done":
              queryStatus[evt.query] = "done";
              redrawProgress();
              break;
            case "synthesizing":
              setPhase("Synthesizing…");
              // Use the same appendChatMessage pattern as normal streaming
              answerBubble = appendChatMessage("assistant", "", true, provider);
              break;
            case "token":
              if (answerBubble) {
                content += evt.content;
                renderStreamingMarkdown(answerBubble, content);
                area.scrollTop = area.scrollHeight;
              }
              break;
            case "clarification":
              isClarification = true;
              content = evt.text;
              progressMsgDiv.remove();
              appendChatMessage("assistant", evt.text, false, provider);
              break;
            case "error":
              progressMsgDiv.remove();
              if (answerBubble) answerBubble.closest(".chat-msg")?.remove();
              appendChatMessage("error", `⚠ ${evt.text}`);
              break;
          }
        } catch { }
      }
    }
    reader.cancel();
    if (answerBubble) {
      if (content) {
        answerBubble.innerHTML = renderMarkdown(content);
      } else {
        answerBubble.textContent = "(No response)";
      }
    }

    if (content && !isClarification) {
      conv.messages.push({ role: "assistant", content, provider, model, timestamp: Date.now() });
      updateConversation(conv.id, {});
      if (isFirstAssistant) generateChatTitle(conv.id, text, provider, model);
    } else if (isClarification) {
      conv.messages.push({ role: "assistant", content, provider, model, timestamp: Date.now() });
      updateConversation(conv.id, {});
    }
  } catch (err) {
    appendChatMessage("error", `⚠ ${err.message}`);
  } finally {
    state.chatStreaming = false;
    $("#chat-send")?.removeAttribute("disabled");
    const wt = $("#chat-web-toggle");
    if (wt) wt.disabled = false;
    const dt2 = $("#chat-deep-toggle");
    if (dt2) dt2.disabled = false;
  }
}

async function sendChatMessage() {
  if (state.chatDeepResearch) return sendDeepResearch();

  const input = $("#chat-input");
  const text = input?.value.trim();
  const conv = getActiveConversation();
  if (!text || !conv || state.chatStreaming) return;

  state.chatStreaming = true;
  input.value = "";
  updateChatInputHeight();
  $("#chat-send")?.setAttribute("disabled", "");
  hideChatAutocomplete();

  const isFirstAssistant = !conv.messages.some((m) => m.role === "assistant");
  const userMsg = { role: "user", content: text, timestamp: Date.now() };
  conv.messages.push(userMsg);
  updateConversation(conv.id, {});
  const userBubble = appendChatMessage("user", text);

  const { provider, model } = conv;
  const bubble = appendChatMessage("assistant", "", true, provider);
  const apiMessages = conv.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const { text: cleanedText, contexts } = await buildChatContextMessage(text);
    const promptParts = [];
    if (contexts.length) {
      promptParts.push(...contexts);
    }
    let promptText = cleanedText;
    if (state.chatWebSearch) {
      const webCtx = await fetchWebContext(cleanedText);
      if (webCtx) {
        promptParts.push(webCtx);
        userBubble?.closest(".chat-msg")?.classList.add("web-search");
      }
    }
    if (promptParts.length) {
      promptText = `${promptParts.join("\n\n---\n\n")}\n\n---\n\n${cleanedText}`;
    }
    const finalMessages = apiMessages.slice(0, -1).concat({ role: "user", content: promptText });
    const { content, error } = await streamChatResponse(finalMessages, provider, model, bubble);

    if (error) {
      bubble.closest(".chat-msg")?.remove();
      appendChatMessage("error", `⚠ ${error}`);
    } else if (content) {
      const assistantMsg = { role: "assistant", content, provider, model, timestamp: Date.now() };
      conv.messages.push(assistantMsg);
      updateConversation(conv.id, {});
      if (isFirstAssistant) generateChatTitle(conv.id, text, provider, model);
    }
  } finally {
    state.chatStreaming = false;
    const sendBtn = $("#chat-send");
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

async function generateChatTitle(convId, firstMessage, provider, model) {
  const messages = [
    {
      role: "system",
      content:
        "You generate conversation titles. Reply with ONLY the title — 5 words or fewer, no punctuation at the end.",
    },
    { role: "user", content: firstMessage },
  ];
  const dummyBubble = document.createElement("div");
  try {
    const { content } = await streamChatResponse(messages, provider, model, dummyBubble);
    const title = content.trim().slice(0, 60);
    if (title) {
      updateConversation(convId, { title });
      renderChatSidebar();
      if (state.chatActiveId === convId) renderChatToolbar();
    }
  } catch { }
}

function renderChatProviderDropdown() {
  const dropdown = $("#chat-provider-dropdown");
  const conv = getActiveConversation();
  if (!dropdown || !conv) return;

  const providers = [
    {
      key: "llama",
      label: "Llama.cpp",
      models: null,
      available: !!loadLlmSettings().serverUrl,
    },
    {
      key: "claude",
      label: "Claude",
      models: CHAT_MODELS.claude,
      available: state.chatProviders.claude,
    },
    {
      key: "openai",
      label: "OpenAI",
      models: CHAT_MODELS.openai,
      available: state.chatProviders.openai,
    },
  ];

  dropdown.innerHTML = providers
    .map(
      (p) => `
    <div class="chat-provider-option${!p.available ? " disabled" : ""}${conv.provider === p.key ? " active" : ""}"
         data-provider="${p.key}"
         ${!p.available ? 'title="Not configured"' : ""}>
      <span class="chat-provider-name">${p.label}</span>
      ${p.models
          ? `<select class="chat-model-select" data-provider-model="${p.key}"
               ${!p.available ? "disabled" : ""}>
               ${p.models
            .map(
              (m) =>
                `<option value="${m}"${conv.provider === p.key && conv.model === m ? " selected" : ""}>${m}</option>`
            )
            .join("")}
             </select>`
          : ""
        }
    </div>`
    )
    .join("");

  dropdown.querySelectorAll(".chat-provider-option:not(.disabled)").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return;
      const modelSel = el.querySelector("[data-provider-model]");
      switchChatProvider(el.dataset.provider, modelSel?.value || null);
    });
  });

  dropdown.querySelectorAll("[data-provider-model]").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      switchChatProvider(sel.dataset.providerModel, sel.value);
    });
  });
}

function switchChatProvider(provider, model) {
  const conv = getActiveConversation();
  if (!conv) return;
  updateConversation(conv.id, { provider, model });
  closeChatProviderDropdown();
  renderChatToolbar();
}

function openChatProviderDropdown() {
  renderChatProviderDropdown();
  $("#chat-provider-dropdown")?.classList.remove("hidden");
}

function closeChatProviderDropdown() {
  $("#chat-provider-dropdown")?.classList.add("hidden");
}

function bindChat() {
  function newConv() {
    const conv = createConversation(defaultChatProvider());
    openConversation(conv.id);
    renderChatSidebar();
  }

  $("#chat-new-btn")?.addEventListener("click", newConv);
  $("#chat-send")?.addEventListener("click", sendChatMessage);

  $("#chat-web-toggle")?.addEventListener("click", () => {
    state.chatWebSearch = !state.chatWebSearch;
    const btn = $("#chat-web-toggle");
    btn.classList.toggle("active", state.chatWebSearch);
    btn.setAttribute("aria-pressed", String(state.chatWebSearch));
  });

  $("#chat-deep-toggle")?.addEventListener("click", () => {
    state.chatDeepResearch = !state.chatDeepResearch;
    const btn = $("#chat-deep-toggle");
    btn.classList.toggle("active", state.chatDeepResearch);
    btn.setAttribute("aria-pressed", String(state.chatDeepResearch));
    $("#chat-effort-wrap")?.classList.toggle("hidden", !state.chatDeepResearch);
    const input = $("#chat-input");
    if (input) {
      input.placeholder = state.chatDeepResearch
        ? "Ask a research question… (Enter to send)"
        : "Ask anything… (Enter to send)";
    }
  });

  $("#chat-effort-select")?.addEventListener("change", () => {
    saveChatResearchEffort($("#chat-effort-select")?.value || "default");
    renderChatToolbar();
  });

  $("#chat-input")?.addEventListener("keydown", (e) => {
    const autocomplete = getChatAutocompleteState();
    if (autocomplete.visible && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = autocomplete.items.length
        ? (autocomplete.activeIndex + delta + autocomplete.items.length) % autocomplete.items.length
        : 0;
      renderChatAutocomplete(autocomplete.items, autocomplete.range, next);
      return;
    }
    if (autocomplete.visible && e.key === "Tab") {
      e.preventDefault();
      const item = autocomplete.items[autocomplete.activeIndex] || autocomplete.items[0];
      if (item) applyChatAutocompleteItem(item, autocomplete.range);
      return;
    }
    if (autocomplete.visible && e.key === "Escape") {
      e.preventDefault();
      hideChatAutocomplete();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  $("#chat-input")?.addEventListener("input", () => {
    updateChatInputHeight();
    void refreshChatAutocomplete();
  });

  $("#chat-input")?.addEventListener("focus", () => {
    void refreshChatAutocomplete();
  });

  $("#chat-autocomplete")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-chat-autocomplete-value]");
    if (!btn) return;
    const input = $("#chat-input");
    if (!input) return;
    const start = Number(btn.dataset.chatAutocompleteStart);
    const end = Number(btn.dataset.chatAutocompleteEnd);
    applyChatAutocompleteItem(
      {
        insert: btn.dataset.chatAutocompleteValue || "",
      },
      { start, end }
    );
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".chat-input-area")) hideChatAutocomplete();
  });

  $("#chat-provider-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const dropdown = $("#chat-provider-dropdown");
    if (dropdown?.classList.contains("hidden")) {
      openChatProviderDropdown();
    } else {
      closeChatProviderDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".chat-provider-wrap")) closeChatProviderDropdown();
  });

  $("#chat-settings-btn")?.addEventListener("click", () => {
    state.chatSettingsOpen = !state.chatSettingsOpen;
    const panel = $("#chat-settings-panel");
    panel?.classList.toggle("hidden", !state.chatSettingsOpen);
    panel?.setAttribute("aria-expanded", String(state.chatSettingsOpen));
    $("#chat-settings-btn")?.setAttribute("aria-expanded", String(state.chatSettingsOpen));
    if (state.chatSettingsOpen) {
      const s = loadChatSettings();
      const llamaUrl = $("#chat-llama-url");
      const claudeModel = $("#chat-claude-model");
      const openaiModel = $("#chat-openai-model");
      if (llamaUrl) llamaUrl.value = loadLlmSettings().serverUrl;
      if (claudeModel) claudeModel.value = s.claudeModel || "claude-sonnet-4-6";
      if (openaiModel) openaiModel.value = s.openaiModel || "gpt-4o";
    }
  });

  $("#chat-settings-save")?.addEventListener("click", () => {
    const url = $("#chat-llama-url")?.value.trim();
    if (url) saveLlmSettings(url);
    saveChatSettings({
      claudeModel: $("#chat-claude-model")?.value || "claude-sonnet-4-6",
      openaiModel: $("#chat-openai-model")?.value || "gpt-4o",
    });
    state.chatProviders.llama = !!loadLlmSettings().serverUrl;
    state.chatSettingsOpen = false;
    const panel = $("#chat-settings-panel");
    panel?.classList.add("hidden");
    $("#chat-settings-btn")?.setAttribute("aria-expanded", "false");
  });
}

async function initChat() {
  if (state.chatStreaming) return;
  state.chatConversations = loadChatConversations();
  state.chatResearchEffort = loadChatResearchEffort();
  try {
    const data = await fetch("/api/chat/providers").then((r) => r.json());
    state.chatProviders = {
      llama: !!loadLlmSettings().serverUrl,
      claude: !!data.claude,
      openai: !!data.openai,
    };
  } catch {
    state.chatProviders = {
      llama: !!loadLlmSettings().serverUrl,
      claude: false,
      openai: false,
    };
  }
  renderChatSidebar();
  renderChatToolbar();
  if (state.chatConversations.length) {
    openConversation(state.chatConversations[0].id);
  } else {
    renderChatMessages();
    renderChatToolbar();
  }
}

async function testLlmConnection(url) {
  const res = await fetch(`${url.replace(/\/$/, "")}/v1/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.data?.[0]?.id || "unknown";
}

// ── Dashboard LLM quick-ask ────────────────────────────────────

const DASHBOARD_LLM_LABELS = {
  gainers: "top stock gainers",
  losers: "top stock losers",
  unusual_volume: "stocks with unusual trading volume",
};

// Try progressively broader queries for a single ticker, covering today + yesterday.
async function fetchTickerNewsWithFallback(ticker, dateLabel) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayLabel = yesterday.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const queries = [
    `${ticker} stock news ${dateLabel}`,
    `${ticker} stock news ${yesterdayLabel}`,
    `${ticker} stock why moving ${dateLabel} OR ${yesterdayLabel}`,
    `${ticker} stock why moving today`,
    `${ticker} stock`,
  ];
  for (const q of queries) {
    const result = await fetchWebContext(q);
    if (result) return result;
  }
  return null;
}

async function sendDashboardLlmQuery(sub) {
  if (state.llmStreaming) return;
  if (!state.llmOpen) openLlmSidebar();
  showLlmView("chat");

  const label = DASHBOARD_LLM_LABELS[sub] || sub.replace(/_/g, " ");
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // Pull tickers from the already-cached card data
  const cached = state.marketsCache.get(sub);
  const rows = cached?.data?.data?.rows ?? [];
  const cols = cached?.data?.data?.columns ?? [];
  const symCol = cols.find((c) => c.toLowerCase() === "symbol");
  const tickers = rows.slice(0, 5).map((r) => r[symCol]).filter(Boolean);

  const tickerList = tickers.length ? tickers.join(", ") : "the tickers shown";
  const userText = `Today is ${today}. Why are today's ${label} (${tickerList}) moving the way they are? What news or events might explain this?`;

  // Show the user bubble immediately
  state.llmStreaming = true;
  $("#llm-send").disabled = true;
  state.llmHistory.push({ role: "user", content: userText });
  appendLlmMessage("user", userText);
  if (state.llmHistory.length > LLM_HISTORY_MAX) {
    state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
  }

  // Show a status bubble while we fetch
  const statusDiv = document.createElement("div");
  statusDiv.className = "llm-msg assistant";
  statusDiv.innerHTML = `<span class="llm-msg-role">LLM</span><div class="llm-msg-bubble" style="color:#7a7a9a">Fetching news for each ticker…</div>`;
  $("#llm-messages").appendChild(statusDiv);
  $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;

  // Fetch each ticker's news in parallel — retry with broader queries if needed
  let contextBlock = "";
  if (tickers.length) {
    const results = await Promise.all(tickers.map((t) => fetchTickerNewsWithFallback(t, today)));
    const parts = tickers
      .map((t, i) => results[i] ? `### ${t}\n${results[i]}` : null)
      .filter(Boolean);
    if (parts.length) {
      contextBlock = `[Per-ticker news — ${today}]\n\n${parts.join("\n\n---\n\n")}`;
    }
  }


  // Remove the status bubble
  statusDiv.remove();

  // Build the final messages array with injected context
  const systemMsg = { role: "system", content: buildSystemPrompt() };
  const enrichedUser = contextBlock
    ? { role: "user", content: `${contextBlock}\n\n---\n\n${userText}` }
    : { role: "user", content: userText };
  const historyWithout = state.llmHistory.slice(0, -1); // exclude last (already enriched)
  const messages = [systemMsg, ...historyWithout, enrichedUser];

  try {
    const reply = await streamLlmResponse(messages);
    if (reply) {
      state.llmHistory.push({ role: "assistant", content: reply });
      if (state.llmHistory.length > LLM_HISTORY_MAX) {
        state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
      }
    }
  } catch (err) {
    appendLlmMessage("error", `⚠ ${err.message}`);
  } finally {
    state.llmStreaming = false;
    $("#llm-send").disabled = false;
  }
}

function openLlmSidebar() {
  state.llmOpen = true;
  $("#llm-sidebar").classList.add("open");
  $("#llm-btn").classList.add("active");
  $("#llm-backdrop").classList.add("visible");
  updateLlmContextBar();
}

function closeLlmSidebar() {
  state.llmOpen = false;
  $("#llm-sidebar").classList.remove("open");
  $("#llm-btn").classList.remove("active");
  $("#llm-backdrop").classList.remove("visible");
}

function showLlmView(view) {
  $$(".llm-view").forEach((v) => v.classList.remove("active"));
  $(`#llm-${view}-view`).classList.add("active");
}

function getLlmTableRows(limit = 20) {
  const table = $("#result-table");
  if (!table || !table.rows.length) return null;
  const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
  const rows = Array.from(table.querySelectorAll("tbody tr"))
    .slice(0, limit)
    .map((tr) =>
      Object.fromEntries(
        Array.from(tr.querySelectorAll("td")).map((td, i) => [headers[i] || i, td.textContent])
      )
    );
  return rows.length ? rows : null;
}

function buildDashboardLlmContext() {
  const sections = [];
  for (const item of DASHBOARD_MARKETS) {
    const cached = state.marketsCache.get(item.sub);
    if (!cached) continue;
    const rows = cached.data?.data?.rows ?? [];
    const cols = cached.data?.data?.columns ?? [];
    const symbolCol = cols.find((c) => c.toLowerCase() === "symbol");
    const nameCol = cols.find((c) => c.toLowerCase() === "name");
    const changeCol = cols.find((c) => c.toLowerCase() === "change %")
      ?? cols.find((c) => /^change/i.test(c));
    const top5 = rows.slice(0, 5).map((r) => ({
      symbol: r[symbolCol] ?? "—",
      name: r[nameCol] ?? "—",
      ...(changeCol !== undefined ? { change: r[changeCol] } : {}),
    }));
    if (top5.length) sections.push({ label: item.label, tickers: top5 });
  }
  return sections.length ? sections : null;
}

function buildLlmContext() {
  const route = state.route;

  if (route === "ticker") {
    const ticker = state.ticker || "—";
    const tab = state.tickerMainTab;

    if (tab === "chart") {
      const inds = [...state.indicators].join(", ") || "none";
      const comparisons = state.compareTickers.map((item) => item.ticker).join(", ") || "none";
      return {
        description: `${ticker} chart — period: ${state.chartPeriod}, interval: ${state.chartInterval}, indicators: ${inds}, comparisons: ${comparisons}`,
        data: null,
      };
    }
    if (tab === "financials") {
      const view = state.tickerView || "statement";
      const period = $("#ticker-period")?.value === "true" ? "quarterly" : "annual";
      return {
        description: `${ticker} ${view.replace(/_/g, " ")} (${period})`,
        data: getLlmTableRows(20),
      };
    }
    if (tab === "info") {
      const card = $("#ticker-info-body");
      const text = card ? card.innerText.slice(0, 800).trim() : "";
      return {
        description: `${ticker} company info`,
        data: text || null,
      };
    }
  }

  if (route === "markets") {
    return {
      description: `Markets — ${state.marketsSub.replace(/_/g, " ")}`,
      data: getLlmTableRows(20),
    };
  }

  if (route === "dashboard") {
    const dashData = buildDashboardLlmContext();
    const loaded = dashData ? dashData.map((s) => s.label).join(", ") : "market pulse";
    return {
      description: `Dashboard — ${loaded}`,
      data: dashData,
    };
  }

  if (route === "multi") {
    const tickers = ($("#multi-form")?.elements?.tickers?.value || "").replace(/\n/g, ", ");
    const analysis = $("#multi-form")?.elements?.analysis?.value || "analysis";
    return {
      description: `Compare ${analysis}: ${tickers}`,
      data: getLlmTableRows(20),
    };
  }

  if (route === "screener") {
    return {
      description: "Screener results",
      data: getLlmTableRows(20),
    };
  }

  if (route === "dcf") {
    const tickers = ($("#dcf-form")?.elements?.tickers?.value || "").replace(/\n/g, ", ");
    return {
      description: `DCF valuation: ${tickers}`,
      data: getLlmTableRows(10),
    };
  }

  return { description: `${route} page`, data: null };
}

function buildSystemPrompt() {
  const ctx = buildLlmContext();
  let prompt = `You are a financial analysis assistant embedded in StockLens, a SEC EDGAR filings tool.\nThe user is currently viewing: ${ctx.description}.`;
  if (ctx.data) {
    if (typeof ctx.data === "string") {
      prompt += `\n\nContext:\n${ctx.data}`;
    } else if (Array.isArray(ctx.data) && ctx.data.length) {
      prompt += `\n\nVisible data (up to ${ctx.data.length} rows):\n${JSON.stringify(ctx.data)}`;
    }
  }
  prompt += `\n\nAnswer concisely. If asked about data not shown, say so.`;
  return prompt;
}

function updateLlmContextBar() {
  const ctx = buildLlmContext();
  const text = $("#llm-ctx-text");
  const dot = $("#llm-ctx-dot");
  if (!text || !dot) return;
  text.textContent = `Context: ${ctx.description}`;
  dot.classList.toggle("inactive", !ctx.description || ctx.description.includes("—"));
}

async function loadMarketStatus() {
  try {
    const res = await fetch("/api/market-status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.marketStatus = await res.json();
    renderMarketStatus();
    void syncTickerHeaderLive();
  } catch {
    const status = $("#market-status");
    status.classList.remove("open");
    status.classList.add("closed");
    $("#market-status-label").textContent = "Market Status";
    $("#market-status-time").textContent = "Unavailable";
  }
}

function renderMarketStatus() {
  const data = state.marketStatus;
  if (!data) return;
  const status = $("#market-status");
  const label = $("#market-status-label");
  const time = $("#market-status-time");
  const targetMs = Date.parse(data.target);
  const remainingMs = Math.max(0, targetMs - Date.now());

  status.classList.toggle("open", Boolean(data.is_open));
  status.classList.toggle("closed", !data.is_open);
  label.textContent = data.label;
  time.textContent = `${formatCountdown(remainingMs)} until ${data.target_label}`;

  if (remainingMs === 0) {
    loadMarketStatus();
  }
  if (state.route === "ticker") {
    void syncTickerHeaderLive();
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `${days}d ${restHours}h ${minutes}m`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initMarketStatus() {
  loadMarketStatus();
  state.marketStatusTimer = setInterval(renderMarketStatus, 1000);
  setInterval(loadMarketStatus, 5 * 60 * 1000);
}

function routeFromPath() {
  const path = location.pathname;
  if (path.startsWith("/ticker/") || path.startsWith("/etf/") || path.startsWith("/crypto/")) return "ticker";
  const route = path.replace("/", "") || "dashboard";
  return ["dashboard", "chat", "markets", "multi", "watchlist", "screener", "option-screener", "dcf"].includes(route) ? route : "dashboard";
}

function assetTypeFromPath() {
  if (location.pathname.startsWith("/etf/")) return "etf";
  if (location.pathname.startsWith("/crypto/")) return "crypto";
  return "stock";
}

function marketsSubFromPath() {
  const sub = new URLSearchParams(location.search).get("sub");
  return sub && sub.trim() ? sub.trim() : null;
}

function macroTabFromPath() {
  const tab = new URLSearchParams(location.search).get("tab");
  return tab && tab.trim() ? tab.trim() : null;
}

function predictionTabFromPath() {
  const tab = new URLSearchParams(location.search).get("tab");
  return tab && tab.trim() ? tab.trim() : null;
}

function normalizePredictionTab(tab) {
  const normalized = String(tab || "all").trim().toLowerCase();
  const allowed = new Set(["all", "sports", "crypto", "politics", "economics", "weather", "technology", "entertainment", "energy", "other"]);
  return allowed.has(normalized) ? normalized : "all";
}

function tickerFromPath() {
  const m = location.pathname.match(/^\/(?:ticker|etf|crypto)\/([^/]+)/);
  return m ? m[1].toUpperCase() : null;
}

async function fetchAssetInfo(ticker) {
  const response = await fetch(`/api/ticker-info?ticker=${encodeURIComponent(ticker)}`);
  if (!response.ok) throw new Error(`Server error ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function setRoute(route, replace = false) {
  state.route = route;
  if (route !== "markets") {
    setMacroShellVisibleModule(false);
    setPredictionShellVisibleModule(false);
  }
  if (route !== "ticker") {
    void stopTickerPageLiveSession();
  }
  $$(".page").forEach((page) => page.classList.remove("active"));
  $(`#${route}-page`).classList.add("active");
  $("#page-back-row")?.classList.toggle("hidden", route !== "ticker");
  $$(".nav a, .nav button[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
  $$(".nav-group").forEach((group) => {
    const parent = group.querySelector(".nav-parent");
    if (!parent) return;
    const routes = Array.from(group.querySelectorAll("[data-route]")).map((link) => link.dataset.route);
    parent.classList.toggle("active", routes.includes(route));
  });
  if (route !== "markets") {
    $$(".nav-group-markets [data-markets-sub]").forEach((link) => link.classList.remove("active"));
    $$(".nav-group-markets [data-prediction-tab]").forEach((link) => link.classList.remove("active"));
  }
  if (!replace && route !== "ticker") history.pushState({}, "", `/${route}`);
  if (route !== "ticker") state.tickerBackPath = null;
  const resultsVisibleRoutes = new Set(["screener", "dcf"]);
  $(".results").classList.toggle("hidden", !resultsVisibleRoutes.has(route));
  if (state.llmOpen) updateLlmContextBar();
}

function openMarkets(sub = "most_active", replace = false, macroTab = null, predictionTab = null) {
  const cleanSub = sub || "most_active";
  state.marketsSub = cleanSub;
  if (cleanSub === "macro") {
    state.marketsMacroTab = macroTab || state.marketsMacroTab || "gdp";
    setPredictionShellVisibleModule(false);
  } else if (cleanSub === "prediction") {
    state.marketsPredictionTab = normalizePredictionTab(
      predictionTab || macroTab || state.marketsPredictionTab || "all"
    );
    setMacroShellVisibleModule(false);
  } else {
    setMacroShellVisibleModule(false);
    setPredictionShellVisibleModule(false);
  }
  $$(".nav-group-markets [data-markets-sub]").forEach((link) => {
    if (cleanSub === "macro" && link.dataset.macroTab) {
      link.classList.toggle("active", link.dataset.macroTab === state.marketsMacroTab);
      return;
    }
    link.classList.toggle("active", link.dataset.marketsSub === cleanSub);
  });
  $$(".nav-group-markets [data-macro-tab]").forEach((link) => {
    link.classList.toggle(
      "active",
      cleanSub === "macro" && link.dataset.macroTab === state.marketsMacroTab
    );
  });
  $$(".nav-group-markets [data-prediction-tab]").forEach((link) => {
    link.classList.toggle(
      "active",
      cleanSub === "prediction" && normalizePredictionTab(link.dataset.predictionTab) === state.marketsPredictionTab
    );
  });
  setRoute("markets", true);
  const params = new URLSearchParams();
  params.set("sub", cleanSub);
  if (cleanSub === "macro") params.set("tab", state.marketsMacroTab);
  if (cleanSub === "prediction") params.set("tab", state.marketsPredictionTab);
  const url = `/markets?${params.toString()}`;
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
  if (cleanSub === "prediction") {
    runPredictionMarkets(state.marketsPredictionTab);
    return;
  }
  runMarkets(cleanSub, state.marketsMacroTab);
}

// ── Ticker landing page ────────────────────────────────────
async function openTickerPage(ticker, name, options = {}) {
  const pushHistory = options.pushHistory !== false;
  const backPath = options.backPath ?? `${location.pathname}${location.search}`;
  const initialKind = options.assetType || assetTypeFromPath() || "stock";

  await stopTickerPageLiveSession();

  state.tickerBackPath = backPath;
  state.ticker = ticker;
  state.tickerName = name || ticker;
  state.assetType = initialKind;
  state.tickerMainTab = "chart";
  state.tickerView = "income_statement";
  state.tickerFinancialsData = null;
  state.tickerFinancialsAsPercent = false;
  state.compareTickers = [];

  $("#ticker-heading").textContent = state.tickerName;
  renderTickerWatchlistMenu();
  setRoute("ticker", true);
  setTickerMainTab("chart");

  const provisionalPath = `/${initialKind === "etf" ? "etf" : initialKind === "crypto" ? "crypto" : "ticker"}/${ticker}`;
  if (pushHistory) history.pushState({ tickerBackPath: state.tickerBackPath }, "", provisionalPath);
  else if (location.pathname !== provisionalPath) history.replaceState({ tickerBackPath: state.tickerBackPath }, "", provisionalPath);

  runTickerChart();
  void syncTickerHeaderLive();

  try {
    const info = await fetchAssetInfo(ticker);
    const assetType = String(info.asset_type || "").toUpperCase();
    const resolvedKind = assetType === "ETF" ? "etf" : assetType === "CRYPTOCURRENCY" ? "crypto" : "stock";
    state.assetType = resolvedKind;
    state.tickerName = info.name || state.tickerName || ticker;
    $("#ticker-heading").textContent = state.tickerName;
    $("#ticker-eyebrow").textContent = resolvedKind === "etf" ? "ETF" : resolvedKind === "crypto" ? "Crypto" : "Ticker";
    renderTickerWatchlistMenu();
    syncTickerPageMode();
    if (resolvedKind !== initialKind) {
      const resolvedPath = `/${resolvedKind === "etf" ? "etf" : resolvedKind === "crypto" ? "crypto" : "ticker"}/${ticker}`;
      history.replaceState({ tickerBackPath: state.tickerBackPath }, "", resolvedPath);
    }
    setTickerMainTab(state.tickerMainTab || "chart");
    if (state.assetType === "etf" && state.tickerMainTab === "holdings") {
      runTickerHoldings();
    }
    if (state.assetType === "crypto" && state.tickerMainTab === "addresses") {
      runCryptoAddresses();
    }
    void syncTickerHeaderLive();
  } catch {
    // Keep the optimistic page render if info lookup fails.
  }
}

function goBackFromTicker() {
  if (state.tickerBackPath) {
    history.back();
    return;
  }
  openMarkets(state.marketsSub || "most_active", true, state.marketsMacroTab, state.marketsPredictionTab);
}

function setTickerMainTab(tab) {
  const normalized = normalizeTickerMainTab(tab);
  state.tickerMainTab = normalized;
  syncTickerPageMode();
  $$(".ticker-main-tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mainTab === normalized)
  );
  $$(".ticker-view").forEach((view) => view.classList.remove("active"));
  $(`#ticker-${normalized}-view`)?.classList.add("active");

  // Show results table only for financials tab
  const showResults = state.assetType !== "etf" && normalized === "financials";
  $(".results").classList.toggle("hidden", !showResults);
  if (state.llmOpen) updateLlmContextBar();
  if (state.route === "ticker") void syncTickerHeaderLive();
}

function normalizeTickerMainTab(tab) {
  const allowed = state.assetType === "etf"
    ? new Set(["chart", "options", "dividends", "holdings", "info"])
    : state.assetType === "crypto"
      ? new Set(["chart", "addresses", "info"])
      : new Set(["chart", "financials", "options", "earnings", "dividends", "info", "insider"]);
  if (allowed.has(tab)) return tab;
  return "chart";
}

function syncTickerPageMode() {
  const isEtf = state.assetType === "etf";
  const isCrypto = state.assetType === "crypto";
  const activeTab = normalizeTickerMainTab(state.tickerMainTab);
  state.tickerMainTab = activeTab;
  $("#ticker-eyebrow").textContent = isEtf ? "ETF" : isCrypto ? "Crypto" : "Ticker";

  const visibleTabs = isEtf
    ? new Set(["chart", "options", "dividends", "holdings", "info"])
    : isCrypto
      ? new Set(["chart", "addresses", "info"])
      : new Set(["chart", "financials", "options", "earnings", "dividends", "info", "insider"]);

  $$(".ticker-main-tab").forEach((btn) => {
    const tab = btn.dataset.mainTab;
    const show = visibleTabs.has(tab);
    btn.classList.toggle("hidden", !show);
    btn.classList.toggle("active", tab === activeTab && show);
  });

  $$(".ticker-view").forEach((view) => {
    const tab = view.id.replace(/^ticker-/, "").replace(/-view$/, "");
    const show = visibleTabs.has(tab);
    view.classList.toggle("hidden", !show);
    if (!show) view.classList.remove("active");
  });

}

// Chart tab
async function runTickerChart() {
  const ticker = state.ticker;
  if (!ticker) return;
  const period = state.chartPeriod || "1mo";
  const interval = state.chartInterval || chartIntervalForPeriod(period);
  const comparing = state.compareTickers.length > 0;
  const needsInds = !comparing && state.indicators.size > 0;
  const liveMode = state.chartLive || state.chartLivePendingStart;
  const forceRefresh = false;

  const wrap = $("#ticker-chart-wrap");
  const hasExistingChart = wrap && wrap.querySelector("svg");
  if (!liveMode || !hasExistingChart) {
    wrap.innerHTML = `<div class="chart-loading">Loading…</div>`;
  } else {
    wrap.classList.add("chart-refreshing");
  }
  state.chartRows = [];
  clearChartAnalysis();
  updateAnalyzeButtonState();
  updateLiveButtonState();
  // Remove any previous subchart panels before rebuilding them.
  $$(".subchart-wrap").forEach((el) => el.remove());
  renderCompareTiles();

  try {
    const candleData = await fetchCandleRows(
      ticker,
      period,
      interval,
      needsInds,
      forceRefresh,
      state.chartLive || state.chartLivePendingStart || state.tickerHeaderLive || state.tickerHeaderLivePending ? "live" : "normal"
    );
    const rows = candleData.rows || [];
    state.chartLiveQuote = candleData.live_quote || null;
    state.chartRows = rows;
    updateTickerHeaderPrice(rows, state.chartLiveQuote);
    const displayRows = liveMode ? rows.slice(-currentChartLookback()) : rows;

    if (comparing) {
      const compareSeries = await Promise.all(
        state.compareTickers.map(async (item) => ({
          ...item,
          rows: (await fetchCandleRows(item.ticker, period, interval, false, forceRefresh)).rows || [],
        }))
      );
      renderCompareChart(rows, wrap, compareSeries);
      wrap.classList.remove("chart-refreshing");
      updateAnalyzeButtonState();
      updateTickerHeaderPrice(rows, state.chartLiveQuote);
      return;
    }

    const activeOverlays = [...state.indicators].filter(
      (k) => INDICATOR_DEFS[k]?.group === "overlay"
    );
    const activePanels = [...state.indicators].filter(
      (k) => INDICATOR_DEFS[k]?.group === "panel"
    );

    renderCandleChart(
      displayRows,
      wrap,
      activeOverlays,
      state.chartAnalysis?.rectangles || [],
      state.chartAnalysisSelectedIndex ?? -1,
      state.chartLiveQuote
    );
    wrap.classList.remove("chart-refreshing");

    // Append subchart panels after the main chart wrap
    const chartView = $("#ticker-chart-view");
    activePanels.forEach((key) => {
      const panel = document.createElement("div");
      panel.className = "subchart-wrap";
      const lbl = document.createElement("div");
      lbl.className = "subchart-label";
      lbl.textContent = key.toUpperCase();
      panel.appendChild(lbl);
      chartView.appendChild(panel);
      renderSubchart(displayRows, panel, key);
    });
    updateAnalyzeButtonState();
    updateLiveButtonState();
    updateTickerHeaderPrice(rows, state.chartLiveQuote);
  } catch (err) {
    wrap.classList.remove("chart-refreshing");
    wrap.innerHTML = `<div class="chart-empty">${escapeHtml(err.message)}</div>`;
    updateTickerHeaderPrice();
    updateAnalyzeButtonState();
    updateLiveButtonState();
  }
}

async function fetchCandleRows(ticker, period, interval, indicators, forceRefresh = false, cacheMode = null) {
  const useLiveCache = Boolean(
    cacheMode === "live" ||
    state.chartLive ||
    state.chartLivePendingStart
  );
  const res = await fetch("/api/candles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker,
      period,
      interval,
      indicators,
      force_refresh: forceRefresh,
      cache_mode: useLiveCache ? "live" : "normal",
    }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function chartIntervalForPeriod(period) {
  if (period === "1d") return "1m";
  if (period === "5d") return "5m";
  if (period === "5y" || period === "max") return "1wk";
  return "1d";
}

function chartHoverLabel(row, period) {
  const timestamp = row?.date ? String(row.date).replace("T", " ").slice(0, 16) : "—";
  if (period === "1d" || period === "5d") return timestamp;
  return String(row?.date || "—").slice(0, 10);
}

function normalizedPerformanceRows(rows) {
  const base = rows.find((row) => Number(row.close) > 0);
  if (!base) return [];
  const baseClose = Number(base.close);
  return rows.map((row) => ({
    date: String(row.date).slice(0, 10),
    value: Number(row.close) > 0 ? ((Number(row.close) / baseClose) - 1) * 100 : null,
  }));
}

function renderCompareChart(mainRows, container, compareSeries) {
  container.innerHTML = "";
  if (!mainRows.length) {
    container.innerHTML = '<div class="chart-empty">No data available.</div>';
    return;
  }

  const W = container.clientWidth || 760;
  const H = 320;
  const pL = 62, pR = 78, pT = 18, pB = 36;
  const innerH = H - pT - pB;
  const NS = "http://www.w3.org/2000/svg";

  const main = {
    ticker: state.ticker,
    name: state.ticker,
    color: "#C8FF00",
    points: normalizedPerformanceRows(mainRows),
  };
  const others = compareSeries.map((series) => {
    const byDate = new Map(normalizedPerformanceRows(series.rows).map((point) => [point.date, point.value]));
    return {
      ticker: series.ticker,
      name: series.name || series.ticker,
      color: series.color,
      points: main.points.map((point) => ({
        date: point.date,
        value: byDate.has(point.date) ? byDate.get(point.date) : null,
      })),
    };
  });
  const seriesList = [main, ...others];
  const n = main.points.length;
  const values = seriesList.flatMap((series) =>
    series.points.map((point) => point.value).filter((value) => value != null && Number.isFinite(value))
  );
  if (!values.length) {
    container.innerHTML = '<div class="chart-empty">No comparison data available.</div>';
    return;
  }

  let minV = Math.min(...values, 0);
  let maxV = Math.max(...values, 0);
  const pad = Math.max((maxV - minV) * 0.12, 1);
  minV -= pad;
  maxV += pad;
  const range = maxV - minV || 1;
  const xPos = (i) => pL + (i / Math.max(n - 1, 1)) * (W - pL - pR);
  const yPos = (value) => pT + innerH - ((value - minV) / range) * innerH;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  [0, 0.5, 1].forEach((t) => {
    const value = minV + t * range;
    const y = yPos(value);
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", pL); line.setAttribute("x2", W - pR);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#1F1F1F"); line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", pL - 5); label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#3A3734");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = `${value.toFixed(1)}%`;
    svg.appendChild(label);
  });

  const zeroY = yPos(0);
  const zero = document.createElementNS(NS, "line");
  zero.setAttribute("x1", pL); zero.setAttribute("x2", W - pR);
  zero.setAttribute("y1", zeroY); zero.setAttribute("y2", zeroY);
  zero.setAttribute("stroke", "#303030"); zero.setAttribute("stroke-width", "1");
  zero.setAttribute("stroke-dasharray", "4 3");
  svg.appendChild(zero);

  function drawSeries(series, width = 1.6) {
    let d = "";
    let drawing = false;
    series.points.forEach((point, i) => {
      if (point.value == null || !Number.isFinite(point.value)) {
        drawing = false;
        return;
      }
      d += `${drawing ? "L" : "M"}${xPos(i)},${yPos(point.value)}`;
      drawing = true;
    });
    if (!d) return;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", series.color);
    path.setAttribute("stroke-width", width);
    svg.appendChild(path);
  }

  seriesList.forEach((series, index) => drawSeries(series, index === 0 ? 1.8 : 1.4));

  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", xPos(i));
    lbl.setAttribute("y", H - pB + 16);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("fill", "#3A3734");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono, monospace");
    lbl.textContent = main.points[i]?.date || "";
    svg.appendChild(lbl);
  });

  seriesList.forEach((series, index) => {
    const y = 18 + index * 18;
    const swatch = document.createElementNS(NS, "rect");
    swatch.setAttribute("x", W - pR + 14); swatch.setAttribute("y", y - 8);
    swatch.setAttribute("width", 8); swatch.setAttribute("height", 8);
    swatch.setAttribute("fill", series.color);
    svg.appendChild(swatch);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", W - pR + 28); label.setAttribute("y", y);
    label.setAttribute("fill", "#888480");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = series.ticker;
    svg.appendChild(label);
  });

  const crossV = document.createElementNS(NS, "line");
  crossV.setAttribute("y1", pT); crossV.setAttribute("y2", H - pB);
  crossV.setAttribute("stroke", "#303030"); crossV.setAttribute("stroke-width", "1");
  crossV.setAttribute("stroke-dasharray", "3 3");
  crossV.style.display = "none";
  svg.appendChild(crossV);

  const tooltip = document.createElementNS(NS, "g");
  tooltip.style.display = "none";
  const tooltipBg = document.createElementNS(NS, "rect");
  tooltipBg.setAttribute("fill", "#181818");
  tooltipBg.setAttribute("stroke", "#303030");
  tooltipBg.setAttribute("stroke-width", "1");
  tooltip.appendChild(tooltipBg);
  const tooltipTxt = document.createElementNS(NS, "text");
  tooltipTxt.setAttribute("font-size", "10");
  tooltipTxt.setAttribute("font-family", "JetBrains Mono, monospace");
  tooltipTxt.setAttribute("fill", "#EDEAE2");
  tooltip.appendChild(tooltipTxt);
  svg.appendChild(tooltip);

  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * (W / rect.width);
    const rawI = ((mx - pL) / (W - pL - pR)) * (n - 1);
    const i = Math.max(0, Math.min(n - 1, Math.round(rawI)));
    const x = xPos(i);
    crossV.setAttribute("x1", x); crossV.setAttribute("x2", x);
    crossV.style.display = "";

    const rows = [`${main.points[i]?.date || ""}`];
    seriesList.forEach((series) => {
      const value = series.points[i]?.value;
      rows.push(`${series.ticker}: ${value == null ? "n/a" : `${value.toFixed(2)}%`}`);
    });
    tooltipTxt.innerHTML = "";
    rows.forEach((text, rowIndex) => {
      const tspan = document.createElementNS(NS, "tspan");
      tspan.setAttribute("x", 0);
      tspan.setAttribute("dy", rowIndex === 0 ? "0" : "13");
      tspan.textContent = text;
      tooltipTxt.appendChild(tspan);
    });
    const tw = Math.max(...rows.map((row) => row.length)) * 6.4 + 14;
    const th = rows.length * 13 + 8;
    const tx = Math.min(x + 8, W - pR - tw - 4);
    tooltipBg.setAttribute("x", tx); tooltipBg.setAttribute("y", pT);
    tooltipBg.setAttribute("width", tw); tooltipBg.setAttribute("height", th);
    tooltipTxt.setAttribute("x", tx + 7); tooltipTxt.setAttribute("y", pT + 13);
    tooltip.querySelectorAll("tspan").forEach((tspan) => tspan.setAttribute("x", tx + 7));
    tooltip.style.display = "";
  });

  svg.addEventListener("mouseleave", () => {
    crossV.style.display = "none";
    tooltip.style.display = "none";
  });

  container.appendChild(svg);
}

function renderCandleChart(rows, container, activeOverlays = [], analysisRects = [], activeAnalysisIndex = -1, liveQuote = null) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="chart-empty">No data available.</div>';
    return;
  }

  const W = container.clientWidth || 760;
  const H = 300;
  const pL = 62, pR = 18, pT = 16, pB = 36, volH = 44;
  const priceH = H - pT - pB - volH - 6;
  const n = rows.length;
  const isLiveView = state.chartLive || state.chartLivePendingStart;
  const liveLeftPad = isLiveView ? 64 : 0;
  const liveRightPad = isLiveView ? 84 : 0;
  const chartSpan = Math.max(1, W - pL - pR - liveLeftPad - liveRightPad);

  const closes = rows.map((r) => Number(r.close));
  const volumes = rows.map((r) => Number(r.volume));
  const livePrice = Number(liveQuote?.price);

  // Expand price range to include any active overlay values so lines stay in-bounds
  const OVERLAY_COLS = {
    sma_20: 1, sma_50: 1, sma_200: 1, ema_12: 1, ema_26: 1,
    bb_upper: 1, bb_middle: 1, bb_lower: 1
  };
  let allPrices = [...closes];
  if (Number.isFinite(livePrice) && livePrice > 0) allPrices.push(livePrice);
  if (activeOverlays.length) {
    const cols = activeOverlays.includes("bb")
      ? activeOverlays.filter((k) => k !== "bb").concat(["bb_upper", "bb_lower"])
      : activeOverlays;
    cols.forEach((col) => {
      if (rows[0]?.[col] !== undefined) {
        rows.forEach((r) => {
          const v = Number(r[col]);
          if (!isNaN(v) && v > 0) allPrices.push(v);
        });
      }
    });
  }
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
  const rangeP = maxP - minP || 1;
  const maxV = Math.max(...volumes) || 1;

  const xPos = (i) => pL + liveLeftPad + (i / Math.max(n - 1, 1)) * chartSpan;
  const yPrice = (p) => pT + priceH - ((p - minP) / rangeP) * priceH;
  const yVolBase = H - pB;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  // Defs: area gradient
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `
    <linearGradient id="cag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#C8FF00" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#C8FF00" stop-opacity="0.01"/>
    </linearGradient>`;
  svg.appendChild(defs);

  // Horizontal gridlines (3 levels)
  [0, 0.5, 1].forEach((t) => {
    const price = minP + t * rangeP;
    const y = yPrice(price);
    const g = document.createElementNS(NS, "line");
    g.setAttribute("x1", pL); g.setAttribute("x2", W - pR);
    g.setAttribute("y1", y); g.setAttribute("y2", y);
    g.setAttribute("stroke", "#1F1F1F"); g.setAttribute("stroke-width", "1");
    svg.appendChild(g);
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", pL - 5); label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "#3A3734");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "JetBrains Mono, monospace");
    label.textContent = price.toFixed(2);
    svg.appendChild(label);
  });

  // Volume bars
  const barW = Math.max(1, chartSpan / n - 1);
  rows.forEach((r, i) => {
    const bh = (Number(r.volume) / maxV) * volH;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", xPos(i) - barW / 2);
    rect.setAttribute("y", yVolBase - bh);
    rect.setAttribute("width", barW);
    rect.setAttribute("height", bh);
    rect.setAttribute("fill", "#252525");
    svg.appendChild(rect);
  });

  // Area fill
  const pts = rows.map((r, i) => `${xPos(i)},${yPrice(Number(r.close))}`);
  const lineD = "M" + pts.join("L");
  const area = document.createElementNS(NS, "path");
  area.setAttribute("d", `${lineD}L${xPos(n - 1)},${pT + priceH}L${pL},${pT + priceH}Z`);
  area.setAttribute("fill", "url(#cag)");
  svg.appendChild(area);

  analysisRects.forEach((rectSpec, rectIndex) => {
    const start = Math.max(0, Math.min(n - 1, rectSpec.startIndex ?? 0));
    const end = Math.max(start, Math.min(n - 1, rectSpec.endIndex ?? start));
    const slice = rows.slice(start, end + 1);
    const highs = slice.map((r) => Number(r.high)).filter((v) => Number.isFinite(v));
    const lows = slice.map((r) => Number(r.low)).filter((v) => Number.isFinite(v));
    if (!highs.length || !lows.length) return;
    const x1 = xPos(start) - barW / 2 - 2;
    const x2 = xPos(end) + barW / 2 + 2;
    const y1 = yPrice(Math.max(...highs)) - 4;
    const y2 = yPrice(Math.min(...lows)) + 4;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.max(4, Math.abs(x2 - x1));
    const height = Math.max(4, Math.abs(y2 - y1));
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", left);
    rect.setAttribute("y", top);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    const isActive = rectIndex === activeAnalysisIndex;
    rect.setAttribute("fill", isActive ? "rgba(255, 75, 75, 0.16)" : "rgba(255, 59, 59, 0.08)");
    rect.setAttribute("stroke", isActive ? "#FFB3B3" : "#FF4B4B");
    rect.setAttribute("stroke-width", isActive ? "2.2" : "1.4");
    rect.setAttribute("rx", "0");
    svg.appendChild(rect);

    const label = String(rectSpec.label || rectSpec.title || "Pattern");
    const labelText = label.length > 24 ? `${label.slice(0, 24)}…` : label;
    const labelChars = Math.max(labelText.length, 3);
    const labelW = Math.min(width - 8, Math.max(52, labelChars * 6.1 + 14));
    const labelH = 16;
    const labelX = left + 4;
    const labelY = top + 4;
    const labelBg = document.createElementNS(NS, "rect");
    labelBg.setAttribute("x", labelX);
    labelBg.setAttribute("y", labelY);
    labelBg.setAttribute("width", labelW);
    labelBg.setAttribute("height", labelH);
    labelBg.setAttribute("fill", isActive ? "#ff4b4b" : "#b33b3b");
    labelBg.setAttribute("opacity", isActive ? "0.98" : "0.92");
    svg.appendChild(labelBg);
    const labelTxt = document.createElementNS(NS, "text");
    labelTxt.setAttribute("x", labelX + 6);
    labelTxt.setAttribute("y", labelY + 11);
    labelTxt.setAttribute("fill", "#FFFFFF");
    labelTxt.setAttribute("font-size", "9");
    labelTxt.setAttribute("font-family", "JetBrains Mono, monospace");
    labelTxt.setAttribute("font-weight", "700");
    labelTxt.setAttribute("text-anchor", "start");
    labelTxt.textContent = labelText.toUpperCase();
    svg.appendChild(labelTxt);
  });

  // ── Overlay lines ──────────────────────────────────────────
  function makePath(col, color, width = 1.2, dash = "") {
    const pts = rows
      .map((r, i) => {
        const v = Number(r[col]);
        return !isNaN(v) && v > 0 ? `${xPos(i)},${yPrice(v)}` : null;
      })
      .filter(Boolean);
    if (pts.length < 2) return;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.join("L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width);
    if (dash) p.setAttribute("stroke-dasharray", dash);
    svg.appendChild(p);
  }

  if (activeOverlays.includes("bb") && rows[0]?.bb_upper !== undefined) {
    // BB fill between upper and lower
    const upperPts = rows.map((r, i) => `${xPos(i)},${yPrice(Number(r.bb_upper))}`);
    const lowerPts = [...rows].reverse().map((r, i) =>
      `${xPos(n - 1 - i)},${yPrice(Number(r.bb_lower))}`
    );
    const fill = document.createElementNS(NS, "path");
    fill.setAttribute("d", "M" + upperPts.join("L") + "L" + lowerPts.join("L") + "Z");
    fill.setAttribute("fill", "rgba(179,136,255,0.07)");
    fill.setAttribute("stroke", "none");
    svg.appendChild(fill);
    makePath("bb_upper", "#B388FF", 1.0, "4 3");
    makePath("bb_lower", "#B388FF", 1.0, "4 3");
    makePath("bb_middle", "#B388FF", 0.8);
  }

  const SIMPLE_OVERLAYS = [
    ["sma_20", "#4FC3F7"],
    ["sma_50", "#FFB800"],
    ["sma_200", "#FF4B4B"],
    ["ema_12", "#00E5A0"],
    ["ema_26", "#FF8A65"],
  ];
  SIMPLE_OVERLAYS.forEach(([col, color]) => {
    if (activeOverlays.includes(col)) makePath(col, color);
  });

  // Price line
  const line = document.createElementNS(NS, "path");
  line.setAttribute("d", lineD);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#C8FF00");
  line.setAttribute("stroke-width", "1.5");
  svg.appendChild(line);

  // Date labels: first, mid, last
  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const lbl = document.createElementNS(NS, "text");
    lbl.setAttribute("x", xPos(i));
    lbl.setAttribute("y", H - pB + 14);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("fill", "#3A3734");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "JetBrains Mono, monospace");
    lbl.textContent = String(rows[i].date).slice(0, isLiveView ? 16 : 10);
    svg.appendChild(lbl);
  });

  // Current price tag
  const lastClose = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : closes[n - 1];
  const tagY = yPrice(lastClose);
  const tag = document.createElementNS(NS, "rect");
  const tagX = Math.min(W - pR - 58, xPos(n - 1) + 10);
  tag.setAttribute("x", tagX); tag.setAttribute("y", tagY - 9);
  tag.setAttribute("width", 56); tag.setAttribute("height", 17);
  tag.setAttribute("fill", "#C8FF00");
  svg.appendChild(tag);
  const tagTxt = document.createElementNS(NS, "text");
  tagTxt.setAttribute("x", tagX + 28); tagTxt.setAttribute("y", tagY + 4);
  tagTxt.setAttribute("text-anchor", "middle");
  tagTxt.setAttribute("fill", "#000");
  tagTxt.setAttribute("font-size", "10");
  tagTxt.setAttribute("font-family", "Syne, sans-serif");
  tagTxt.setAttribute("font-weight", "700");
  tagTxt.textContent = lastClose.toFixed(2);
  svg.appendChild(tagTxt);

  // Hover crosshair + tooltip
  const crossV = document.createElementNS(NS, "line");
  crossV.setAttribute("y1", pT); crossV.setAttribute("y2", H - pB);
  crossV.setAttribute("stroke", "#303030"); crossV.setAttribute("stroke-width", "1");
  crossV.setAttribute("stroke-dasharray", "3 3");
  crossV.style.display = "none";
  svg.appendChild(crossV);

  const tooltip = document.createElementNS(NS, "g");
  tooltip.style.display = "none";
  const tooltipBg = document.createElementNS(NS, "rect");
  tooltipBg.setAttribute("rx", "0");
  tooltipBg.setAttribute("fill", "#181818");
  tooltipBg.setAttribute("stroke", "#303030");
  tooltipBg.setAttribute("stroke-width", "1");
  const tooltipTxt = document.createElementNS(NS, "text");
  tooltipTxt.setAttribute("font-size", "11");
  tooltipTxt.setAttribute("font-family", "JetBrains Mono, monospace");
  tooltipTxt.setAttribute("fill", "#EDEAE2");
  tooltip.appendChild(tooltipBg);
  tooltip.appendChild(tooltipTxt);
  svg.appendChild(tooltip);

  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const rawI = ((mx - pL) / (W - pL - pR)) * (n - 1);
    const i = Math.max(0, Math.min(n - 1, Math.round(rawI)));
    const x = xPos(i);
    const row = rows[i];
    const price = Number(row.close);

    crossV.setAttribute("x1", x); crossV.setAttribute("x2", x);
    crossV.style.display = "";

    const liveQuoteText = Number.isFinite(livePrice) && i === n - 1
      ? `  live ${livePrice.toFixed(2)}`
      : "";
    const txt = `${chartHoverLabel(row, state.chartPeriod)}  ${price.toFixed(2)}${liveQuoteText}`;
    tooltipTxt.textContent = txt;
    const tw = txt.length * 7 + 12;
    const th = 20;
    const tx = Math.min(x + 8, W - pR - tw - 4 - liveRightPad);
    tooltipBg.setAttribute("x", tx); tooltipBg.setAttribute("y", pT);
    tooltipBg.setAttribute("width", tw); tooltipBg.setAttribute("height", th);
    tooltipTxt.setAttribute("x", tx + 6); tooltipTxt.setAttribute("y", pT + 13);
    tooltip.style.display = "";
  });

  svg.addEventListener("mouseleave", () => {
    crossV.style.display = "none";
    tooltip.style.display = "none";
  });

  container.appendChild(svg);
}

// ── Subchart panels (MACD / RSI / ATR) ────────────────────
function renderSubchart(rows, container, type) {
  const NS = "http://www.w3.org/2000/svg";
  const W = container.clientWidth || 760;
  const H = 90;
  const pL = 62, pR = 18, pT = 8, pB = 18;
  const innerH = H - pT - pB;
  const n = rows.length;
  const xPos = (i) => pL + (i / Math.max(n - 1, 1)) * (W - pL - pR);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";

  function yScale(val, minV, maxV) {
    const r = maxV - minV || 1;
    return pT + innerH - ((val - minV) / r) * innerH;
  }

  function hline(y, color = "#1F1F1F", dash = "") {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", pL); l.setAttribute("x2", W - pR);
    l.setAttribute("y1", y); l.setAttribute("y2", y);
    l.setAttribute("stroke", color); l.setAttribute("stroke-width", "1");
    if (dash) l.setAttribute("stroke-dasharray", dash);
    svg.appendChild(l);
  }

  function pathFrom(vals, minV, maxV, color, width = 1.2) {
    const pts = vals.map((v, i) =>
      v != null && !isNaN(v) ? `${xPos(i)},${yScale(v, minV, maxV)}` : null
    ).filter(Boolean);
    if (pts.length < 2) return;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M" + pts.join("L"));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width);
    svg.appendChild(p);
  }

  function axisLabel(text, y) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", pL - 5); t.setAttribute("y", y + 4);
    t.setAttribute("text-anchor", "end");
    t.setAttribute("fill", "#3A3734");
    t.setAttribute("font-size", "9");
    t.setAttribute("font-family", "JetBrains Mono, monospace");
    t.textContent = text;
    svg.appendChild(t);
  }

  // Right-side value tag — mirrors the main chart's current-price pip
  function valueTag(val, y, color) {
    const text = typeof val === "number" ? val.toFixed(Math.abs(val) < 10 ? 3 : 2) : String(val);
    const tw = Math.max(38, text.length * 6.2 + 8);
    const th = 14;
    const tx = W - pR - tw + 2;
    // Dashed reference line to the tag
    const ref = document.createElementNS(NS, "line");
    ref.setAttribute("x1", pL); ref.setAttribute("x2", tx);
    ref.setAttribute("y1", y); ref.setAttribute("y2", y);
    ref.setAttribute("stroke", color);
    ref.setAttribute("stroke-width", "0.5");
    ref.setAttribute("stroke-dasharray", "3 3");
    ref.setAttribute("opacity", "0.5");
    svg.appendChild(ref);
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", tx); bg.setAttribute("y", y - th / 2);
    bg.setAttribute("width", tw); bg.setAttribute("height", th);
    bg.setAttribute("fill", color);
    svg.appendChild(bg);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", tx + tw / 2); t.setAttribute("y", y + 4);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#000");
    t.setAttribute("font-size", "9");
    t.setAttribute("font-family", "JetBrains Mono, monospace");
    t.setAttribute("font-weight", "700");
    t.textContent = text;
    svg.appendChild(t);
  }

  function lastValid(vals) {
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i] != null && !isNaN(vals[i])) return vals[i];
    }
    return null;
  }

  if (type === "macd") {
    const macd = rows.map((r) => r.macd != null ? Number(r.macd) : null);
    const sig = rows.map((r) => r.macd_signal != null ? Number(r.macd_signal) : null);
    const hist = rows.map((r) => r.macd_histogram != null ? Number(r.macd_histogram) : null);
    const allV = [...macd, ...sig, ...hist].filter((v) => v != null);
    const minV = Math.min(...allV), maxV = Math.max(...allV);
    const zeroY = yScale(0, minV, maxV);

    hline(zeroY, "#252525");
    axisLabel("0", zeroY);

    // Histogram bars
    const barW = Math.max(1, (W - pL - pR) / n - 1);
    hist.forEach((v, i) => {
      if (v == null) return;
      const y1 = yScale(v, minV, maxV);
      const y2 = zeroY;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", xPos(i) - barW / 2);
      rect.setAttribute("y", Math.min(y1, y2));
      rect.setAttribute("width", barW);
      rect.setAttribute("height", Math.abs(y2 - y1) || 1);
      rect.setAttribute("fill", v >= 0 ? "rgba(0,229,160,0.45)" : "rgba(255,75,75,0.45)");
      svg.appendChild(rect);
    });

    pathFrom(sig, minV, maxV, "#FF8A65", 1.2);
    pathFrom(macd, minV, maxV, "#4FC3F7", 1.4);

    const lastMacd = lastValid(macd);
    const lastSig = lastValid(sig);
    if (lastSig != null) valueTag(lastSig, yScale(lastSig, minV, maxV), "#FF8A65");
    if (lastMacd != null) valueTag(lastMacd, yScale(lastMacd, minV, maxV), "#4FC3F7");

  } else if (type === "rsi") {
    const rsi = rows.map((r) => r.rsi != null ? Number(r.rsi) : null);
    const minV = 0, maxV = 100;

    hline(yScale(70, minV, maxV), "#252525", "3 3");
    hline(yScale(50, minV, maxV), "#1F1F1F");
    hline(yScale(30, minV, maxV), "#252525", "3 3");
    axisLabel("70", yScale(70, minV, maxV));
    axisLabel("30", yScale(30, minV, maxV));

    // Color RSI line by zone
    let segStart = null, segColor = null;
    function flushSeg(endI) {
      if (segStart == null) return;
      const pts = [];
      for (let k = segStart; k <= endI; k++) {
        if (rsi[k] == null) continue;
        pts.push(`${xPos(k)},${yScale(rsi[k], minV, maxV)}`);
      }
      if (pts.length < 2) return;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", "M" + pts.join("L"));
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", segColor);
      p.setAttribute("stroke-width", "1.4");
      svg.appendChild(p);
    }
    rsi.forEach((v, i) => {
      const c = v >= 70 ? "#FF4B4B" : v <= 30 ? "#00E5A0" : "#C8FF00";
      if (c !== segColor) { flushSeg(i - 1); segStart = i; segColor = c; }
    });
    flushSeg(n - 1);

    const lastRsi = lastValid(rsi);
    if (lastRsi != null) {
      const rsiColor = lastRsi >= 70 ? "#FF4B4B" : lastRsi <= 30 ? "#00E5A0" : "#C8FF00";
      valueTag(lastRsi, yScale(lastRsi, minV, maxV), rsiColor);
    }

  } else if (type === "atr") {
    const atr = rows.map((r) => r.atr != null ? Number(r.atr) : null);
    const allV = atr.filter((v) => v != null);
    const minV = 0, maxV = Math.max(...allV) || 1;

    hline(yScale(maxV, minV, maxV), "#1F1F1F");
    axisLabel(maxV.toFixed(2), yScale(maxV, minV, maxV));

    pathFrom(atr, minV, maxV, "#FFB800", 1.4);

    const lastAtr = lastValid(atr);
    if (lastAtr != null) valueTag(lastAtr, yScale(lastAtr, minV, maxV), "#FFB800");
  }

  container.appendChild(svg);
}

// ── Indicator chip wiring ──────────────────────────────────
function bindIndicatorChips() {
  $$(".ind-chip").forEach((chip) => {
    const key = chip.dataset.indicator;
    const color = chip.dataset.color;
    chip.style.setProperty("--ind-color", color);
    chip.addEventListener("click", () => {
      if (state.indicators.has(key)) {
        state.indicators.delete(key);
        chip.classList.remove("active");
      } else {
        state.indicators.add(key);
        chip.classList.add("active");
      }
      runTickerChart();
    });
  });
}

function clearIndicators() {
  state.indicators.clear();
  $$(".ind-chip").forEach((chip) => chip.classList.remove("active"));
}

function renderCompareTiles() {
  const bar = $("#compare-tile-bar");
  const indicatorBar = $("#indicator-bar");
  if (!bar || !indicatorBar) return;
  const comparing = state.compareTickers.length > 0;
  bar.classList.toggle("hidden", !comparing);
  indicatorBar.classList.toggle("hidden", comparing);

  bar.innerHTML = state.compareTickers.map((item) => `
    <div class="compare-tile" style="--compare-color: ${item.color}">
      <span>${escapeHtml(item.ticker)}</span>
      <button type="button" data-compare-remove="${escapeHtml(item.ticker)}" aria-label="Remove ${escapeHtml(item.ticker)}">×</button>
    </div>
  `).join("");
  $$("[data-compare-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeCompareTicker(btn.dataset.compareRemove);
    });
  });
  updateAnalyzeButtonState();
}

function addCompareTicker(ticker, name) {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol || symbol === state.ticker) return;
  if (state.compareTickers.some((item) => item.ticker === symbol)) return;
  const color = COMPARE_COLORS[state.compareTickers.length % COMPARE_COLORS.length];
  state.compareTickers.push({ ticker: symbol, name: name || symbol, color });
  clearIndicators();
  closeCompareModal();
  renderCompareTiles();
  runTickerChart();
}

function removeCompareTicker(ticker) {
  state.compareTickers = state.compareTickers.filter((item) => item.ticker !== ticker);
  renderCompareTiles();
  runTickerChart();
}

function openCompareModal() {
  $("#compare-modal").classList.remove("hidden");
  $("#compare-search-input").value = "";
  $("#compare-search-dropdown").innerHTML = "";
  $("#compare-search-dropdown").classList.remove("open");
  $("#compare-search-input").focus();
}

function closeCompareModal() {
  $("#compare-modal").classList.add("hidden");
}

function bindCompareControls() {
  $("#chart-compare-btn").addEventListener("click", openCompareModal);
  $("#compare-modal-close").addEventListener("click", closeCompareModal);
  $("#compare-modal").addEventListener("click", (event) => {
    if (event.target.id === "compare-modal") closeCompareModal();
  });

  const input = $("#compare-search-input");
  const dropdown = $("#compare-search-dropdown");
  let debounceTimer = null;

  function renderResults(results) {
    dropdown.innerHTML = "";
    if (!results.length) {
      dropdown.innerHTML = `<li class="search-empty">No matches</li>`;
      dropdown.classList.add("open");
      return;
    }
    results
      .filter((item) => item.ticker !== state.ticker)
      .filter((item) => !state.compareTickers.some((compare) => compare.ticker === item.ticker))
      .forEach((item) => {
        const li = document.createElement("li");
        li.className = "search-item";
        li.innerHTML = `
          <span class="search-item-ticker">${escapeHtml(item.ticker)}</span>
          <span class="search-item-name">${escapeHtml(item.name || "")}</span>
        `;
        li.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addCompareTicker(item.ticker, item.name);
        });
        dropdown.appendChild(li);
      });
    dropdown.classList.toggle("open", dropdown.children.length > 0);
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < 1) {
      dropdown.classList.remove("open");
      dropdown.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        renderResults(await res.json());
      } catch {
        dropdown.innerHTML = `<li class="search-empty">Search failed</li>`;
        dropdown.classList.add("open");
      }
    }, 150);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCompareModal();
    if (event.key === "Enter") {
      event.preventDefault();
      const first = dropdown.querySelector(".search-item");
      if (!first) return;
      addCompareTicker(
        first.querySelector(".search-item-ticker").textContent,
        first.querySelector(".search-item-name").textContent
      );
    }
  });
}

function bindTickerPage() {
  $("#ticker-watchlist-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTickerWatchlistMenu();
  });
  document.addEventListener("click", (event) => {
    const picker = $("#ticker-watchlist-picker");
    if (picker && !picker.contains(event.target)) closeTickerWatchlistMenu();
  });
  // Main tab switching
  $$(".ticker-main-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.mainTab;
      setTickerMainTab(tab);
      if (tab === "chart") runTickerChart();
      if (tab === "financials") runTickerFinancials();
      if (tab === "options") runTickerOptions();
      if (tab === "earnings") runTickerEarnings();
      if (tab === "dividends") runTickerDividends();
      if (tab === "holdings") runTickerHoldings();
      if (tab === "addresses") runCryptoAddresses();
      if (tab === "info") runTickerInfo();
      if (tab === "insider") runTickerInsider();
    });
  });

  // Chart range buttons
  $$(".chart-range").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".chart-range").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartPeriod = btn.dataset.period;
      state.chartInterval = btn.dataset.interval || chartIntervalForPeriod(btn.dataset.period);
      runTickerChart();
    });
  });

  $("#ticker-options-fetch-dte")?.addEventListener("change", () => {
    if (state.route === "ticker" && state.tickerMainTab === "options") runTickerOptions();
  });

  $("#chart-analyze-btn")?.addEventListener("click", () => {
    void runChartAnalysis();
  });

  $("#chart-live-btn")?.addEventListener("click", async () => {
    if (state.chartLive || state.chartLivePendingStart) {
      await stopChartLive(true);
      return;
    }
    state.chartLivePrevPeriod = state.chartPeriod || "1mo";
    state.chartLivePrevInterval = state.chartInterval || "1d";
    state.chartLivePendingStart = true;
    updateLiveButtonState();
    state.chartPeriod = "1d";
    state.chartInterval = "1m";
    $$(".chart-range").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.period === state.chartPeriod && btn.dataset.interval === state.chartInterval
      );
    });
    clearChartAnalysis();
    void startChartLive();
  });

  $("#chart-live-lookback")?.addEventListener("input", () => {
    const input = $("#chart-live-lookback");
    if (!input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    state.chartLiveLookback = Math.min(500, Math.max(10, Math.floor(value)));
    if (state.chartLive || state.chartLivePendingStart) {
      rerenderCurrentTickerChart();
    }
  });

  bindTickerFinancialsControls();
}

function formValue(form, name) {
  const field = form.elements[name];
  if (!field) return null;
  if (field.type === "checkbox") return field.checked;
  return field.value;
}

function addFilter(metric = "pe_ratio", op = "<", value = 30) {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.innerHTML = `
    <select data-filter="metric">${state.metrics.map((m) => `<option value="${m}">${m}</option>`).join("")}</select>
    <select data-filter="op">
      ${["<", "<=", ">", ">=", "==", "!="].map((item) => `<option value="${item}">${item}</option>`).join("")}
    </select>
    <input data-filter="value" type="number" step="0.01" />
    <button type="button" aria-label="Remove filter">×</button>
  `;
  row.querySelector('[data-filter="metric"]').value = metric;
  row.querySelector('[data-filter="op"]').value = op;
  row.querySelector('[data-filter="value"]').value = value;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("#filter-list").appendChild(row);
}

function collectFilters() {
  return $$(".filter-row").map((row) => ({
    metric: row.querySelector('[data-filter="metric"]').value,
    op: row.querySelector('[data-filter="op"]').value,
    value: row.querySelector('[data-filter="value"]').value,
    enabled: true,
  }));
}

function selectedOptions(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function loadWatchlists() {
  try {
    state.watchlists = JSON.parse(localStorage.getItem("secrs.watchlists") || "[]");
  } catch {
    state.watchlists = [];
  }
  renderTickerWatchlistMenu();
  renderOptionScreenerWatchlists();
}

function saveWatchlists() {
  localStorage.setItem("secrs.watchlists", JSON.stringify(state.watchlists));
  renderTickerWatchlistMenu();
  renderOptionScreenerWatchlists();
}

function renderWatchlists() {
  const target = $("#watchlists");
  if (!target) return;
  target.innerHTML = "";
  updateWatchlistStats();

  if (state.watchlists.length === 0) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.innerHTML = `
      <p class="watchlist-empty-title">No watchlists yet.</p>
      <p class="watchlist-empty-copy">Start with a manual list on the left or import a CSV to seed your first compare set.</p>
    `;
    target.appendChild(empty);
    return;
  }

  state.watchlists.forEach((watchlist) => {
    const item = document.createElement("article");
    item.className = "watchlist-item";
    item.draggable = true;
    item.dataset.watchlistId = watchlist.id;
    const expanded = state.expandedWatchlists.has(watchlist.id);
    const previewTickers = expanded ? watchlist.tickers : watchlist.tickers.slice(0, 10);
    const hiddenCount = Math.max(watchlist.tickers.length - previewTickers.length, 0);
    const toggleLabel = expanded ? "Condense" : "Expand";
    const screenerReady = watchlist.tickers.length >= 1 ? "Ready" : "Empty";
    item.innerHTML = `
      <div class="watchlist-card-main">
        <div class="watchlist-card-head">
          <div>
            <p class="eyebrow">${watchlist.tickers.length} tickers</p>
            <h2>${escapeHtml(watchlist.name)}</h2>
          </div>
          <div class="watchlist-card-badges">
            <span class="watchlist-badge">${escapeHtml(screenerReady)}</span>
            <span class="watchlist-badge">${expanded ? "Expanded" : "Compact"}</span>
            <button class="watchlist-drag-handle" type="button" aria-label="Drag to reorder" title="Drag to reorder">⋮⋮</button>
          </div>
        </div>
        <div class="watchlist-chip-row">
          ${previewTickers.map((ticker) => `
            <span class="watchlist-chip removable" data-chip-ticker="${escapeHtml(ticker)}">
              <span>${escapeHtml(ticker)}</span>
              <button type="button" class="watchlist-chip-remove" data-remove-ticker="${escapeHtml(ticker)}" aria-label="Remove ${escapeHtml(ticker)}">×</button>
            </span>
          `).join("")}
          ${hiddenCount ? `<span class="watchlist-chip more">+${hiddenCount}</span>` : ""}
        </div>
        <p class="watchlist-tickers ${expanded ? "expanded" : "condensed"}">
          ${escapeHtml(watchlist.tickers.join(", "))}
        </p>
        <form class="watchlist-inline-add" data-watchlist-add-form>
          <input
            class="watchlist-inline-input"
            name="ticker"
            type="text"
            autocomplete="off"
            placeholder="Add ticker"
            aria-label="Add ticker to ${escapeHtml(watchlist.name)}"
          />
          <button type="submit" class="watchlist-inline-btn">Add</button>
        </form>
      </div>
      <div class="watchlist-actions">
        <button class="secondary" type="button" data-action="toggle">${toggleLabel}</button>
        <button type="button" data-action="multi">Compare</button>
        <button type="button" data-action="screener">Screener</button>
        <button type="button" data-action="dcf">DCF</button>
        <button class="secondary" type="button" data-action="edit">Edit</button>
        <button class="danger" type="button" data-action="delete">Delete</button>
      </div>
    `;
    item.querySelector('[data-action="toggle"]').addEventListener("click", () => toggleWatchlist(watchlist.id));
    item.querySelector('[data-action="multi"]').addEventListener("click", () => applyWatchlist(watchlist, "multi"));
    item.querySelector('[data-action="screener"]').addEventListener("click", () => applyWatchlist(watchlist, "screener"));
    item.querySelector('[data-action="dcf"]').addEventListener("click", () => applyWatchlist(watchlist, "dcf"));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => editWatchlist(watchlist.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteWatchlist(watchlist.id));
    item.querySelectorAll('[data-remove-ticker]').forEach((btn) => {
      btn.addEventListener("click", () => removeTickerFromWatchlist(watchlist.id, btn.dataset.removeTicker));
    });
    item.querySelector('[data-watchlist-add-form]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const ticker = form.elements.ticker.value || "";
      if (addTickerToWatchlist(watchlist.id, ticker)) {
        form.reset();
      }
    });
    item.addEventListener("dragstart", (event) => {
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", watchlist.id);
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      $$(".watchlist-item.drag-over").forEach((el) => el.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (!item.classList.contains("dragging")) item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drag-over");
      const draggedId = event.dataTransfer.getData("text/plain");
      if (draggedId && draggedId !== watchlist.id) reorderWatchlists(draggedId, watchlist.id);
    });
    target.appendChild(item);
  });
}

function updateWatchlistStats() {
  const totalEl = $("#watchlist-stat-total");
  const tickersEl = $("#watchlist-stat-tickers");
  const largestEl = $("#watchlist-stat-largest");
  if (!totalEl || !tickersEl || !largestEl) return;
  const total = state.watchlists.length;
  const unique = new Set(
    state.watchlists.flatMap((watchlist) => Array.isArray(watchlist.tickers) ? watchlist.tickers : [])
  );
  const largest = state.watchlists.reduce((max, watchlist) => {
    const count = Array.isArray(watchlist.tickers) ? watchlist.tickers.length : 0;
    return Math.max(max, count);
  }, 0);
  totalEl.textContent = String(total);
  tickersEl.textContent = String(unique.size);
  largestEl.textContent = String(largest);
}

function renderTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  if (!menu) return;

  const ticker = state.ticker;
  if (!ticker) {
    menu.innerHTML = `<div class="ticker-watchlist-empty">Select a ticker first.</div>`;
    return;
  }

  if (state.watchlists.length === 0) {
    menu.innerHTML = `<div class="ticker-watchlist-empty">No watchlists yet.</div>`;
    return;
  }

  menu.innerHTML = "";
  state.watchlists.forEach((watchlist) => {
    const exists = Array.isArray(watchlist.tickers) && watchlist.tickers.includes(ticker);
    const item = document.createElement("button");
    item.className = "ticker-watchlist-item";
    item.type = "button";
    item.disabled = exists;
    item.innerHTML = `
      <span class="ticker-watchlist-name">${escapeHtml(watchlist.name)}</span>
      <span class="ticker-watchlist-check">${exists ? "✓" : ""}</span>
    `;
    if (!exists) {
      item.addEventListener("click", () => {
        addTickerToWatchlist(watchlist.id, ticker);
        closeTickerWatchlistMenu();
      });
    }
    menu.appendChild(item);
  });
}

function addTickerToWatchlist(id, ticker) {
  const watchlist = state.watchlists.find((item) => item.id === id);
  if (!watchlist) return false;
  const current = Array.isArray(watchlist.tickers) ? watchlist.tickers : [];
  const cleaned = uniqueTickers([...current, ticker]);
  if (cleaned.length === current.length) return false;
  watchlist.tickers = cleaned;
  saveWatchlists();
  renderWatchlists();
  setStatus(`${ticker} added to ${watchlist.name}.`, false);
  return true;
}

function removeTickerFromWatchlist(id, ticker) {
  const watchlist = state.watchlists.find((item) => item.id === id);
  if (!watchlist) return;
  const current = Array.isArray(watchlist.tickers) ? watchlist.tickers : [];
  const cleaned = current.filter((item) => item !== String(ticker || "").trim().toUpperCase());
  if (cleaned.length === current.length) return;
  watchlist.tickers = cleaned;
  saveWatchlists();
  renderWatchlists();
  setStatus(`${ticker} removed from ${watchlist.name}.`, false);
}

function reorderWatchlists(sourceId, targetId) {
  const fromIndex = state.watchlists.findIndex((item) => item.id === sourceId);
  const toIndex = state.watchlists.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  const next = [...state.watchlists];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  state.watchlists = next;
  saveWatchlists();
  renderWatchlists();
}

function openTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  const btn = $("#ticker-watchlist-btn");
  if (!menu || !btn) return;
  renderTickerWatchlistMenu();
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
}

function closeTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  const btn = $("#ticker-watchlist-btn");
  if (!menu || !btn) return;
  menu.classList.add("hidden");
  btn.setAttribute("aria-expanded", "false");
}

function toggleTickerWatchlistMenu() {
  const menu = $("#ticker-watchlist-menu");
  if (!menu) return;
  if (menu.classList.contains("hidden")) openTickerWatchlistMenu();
  else closeTickerWatchlistMenu();
}

function toggleWatchlist(id) {
  if (state.expandedWatchlists.has(id)) {
    state.expandedWatchlists.delete(id);
  } else {
    state.expandedWatchlists.add(id);
  }
  renderWatchlists();
}

function upsertWatchlist(name, tickers) {
  const cleaned = uniqueTickers(tickers);
  if (!name.trim()) throw new Error("Enter a watchlist name.");
  if (cleaned.length === 0) throw new Error("Enter at least one ticker.");

  if (state.editingWatchlist) {
    const existing = state.watchlists.find((item) => item.id === state.editingWatchlist);
    if (existing) {
      existing.name = name.trim();
      existing.tickers = cleaned;
    }
  } else {
    state.watchlists.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      name: name.trim(),
      tickers: cleaned,
    });
  }
  state.editingWatchlist = null;
  saveWatchlists();
  renderWatchlists();
}

function editWatchlist(id) {
  const watchlist = state.watchlists.find((item) => item.id === id);
  if (!watchlist) return;
  state.editingWatchlist = id;
  const form = $("#watchlist-form");
  form.elements.name.value = watchlist.name;
  form.elements.manual_tickers.value = watchlist.tickers.join(", ");
  setRoute("watchlist");
}

function deleteWatchlist(id) {
  state.watchlists = state.watchlists.filter((item) => item.id !== id);
  if (state.editingWatchlist === id) state.editingWatchlist = null;
  saveWatchlists();
  renderWatchlists();
}

function applyWatchlist(watchlist, route) {
  const tickers = watchlist.tickers.join(", ");
  if (route === "multi") $("#multi-form").elements.tickers.value = tickers;
  if (route === "screener") $("#screener-form").elements.tickers.value = tickers;
  if (route === "dcf") {
    $("#dcf-form").elements.tickers.value = tickers;
    $("#dcf-form").elements.compare.checked = watchlist.tickers.length > 1;
  }
  setRoute(route);
}

async function loadOptions() {
  const response = await fetch("/api/options");
  const options = await response.json();
  state.metrics = options.metrics;
  const include = $("#include-metrics");
  include.innerHTML = state.metrics.map((metric) => `<option value="${metric}">${metric}</option>`).join("");
  options.default_filters.forEach((item) => addFilter(item.metric, item.op, item.value));
}

function bindForms() {
  $("#multi-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/multi", {
        tickers: tickerList(formValue(form, "tickers")),
        analysis: formValue(form, "analysis"),
        quarterly: formValue(form, "quarterly") === "true",
      });
      $("#result-title").textContent = data.title;
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#screener-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/screener", {
        tickers: tickerList(formValue(form, "tickers")),
        quarterly: formValue(form, "quarterly") === "true",
        max_workers: formValue(form, "max_workers"),
        filters: collectFilters(),
        include_metrics: selectedOptions($("#include-metrics")),
      });
      $("#result-title").textContent = data.title;
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#dcf-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await post("/api/dcf", {
        tickers: tickerList(formValue(form, "tickers")),
        forecast_years: formValue(form, "forecast_years"),
        discount_rate: formValue(form, "discount_rate"),
        terminal_growth_rate: formValue(form, "terminal_growth_rate"),
        growth_rate: formValue(form, "growth_rate"),
        max_growth_rate: formValue(form, "max_growth_rate"),
        auto: formValue(form, "auto"),
        compare: formValue(form, "compare"),
        max_workers: formValue(form, "max_workers"),
      });
      $("#result-title").textContent = data.title;
      renderSummary(data.summary);
      renderTable(data.data);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#watchlist-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      upsertWatchlist(formValue(form, "name"), formValue(form, "manual_tickers"));
      form.elements.name.value = "";
      form.elements.manual_tickers.value = "";
      setStatus("Watchlist saved.", false);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#csv-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.csv_file.files[0];
    if (!file) {
      setStatus("Choose a CSV file.", true);
      return;
    }
    try {
      const content = await file.text();
      const data = await post("/api/watchlist/csv", {
        content,
        ticker_column: formValue(form, "ticker_column"),
      });
      $("#watchlist-form").elements.name.value = file.name.replace(/\.csv$/i, "");
      $("#watchlist-form").elements.manual_tickers.value = data.tickers.join(", ");
      $("#result-title").textContent = "CSV Import";
      renderTable({
        columns: ["ticker"],
        rows: data.tickers.map((ticker) => ({ ticker })),
        height: data.tickers.length,
        width: 1,
      });
      setStatus(`Imported ${data.count} tickers from ${data.ticker_column}. Save the watchlist when ready.`, false);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  $("#add-filter").addEventListener("click", () => addFilter("pe_ratio", "<", 30));
  $("#new-watchlist").addEventListener("click", () => {
    state.editingWatchlist = null;
    $("#watchlist-form").elements.name.value = "";
    $("#watchlist-form").elements.manual_tickers.value = "";
  });
  $$("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      const example = button.dataset.example;
      if (example === "multi") $("#multi-form").requestSubmit();
      if (example === "dcf") {
        $("#dcf-form").elements.tickers.value = "AAPL, MSFT, GOOGL";
        $("#dcf-form").elements.compare.checked = true;
        $("#dcf-form").requestSubmit();
      }
    });
  });
}

function openDashboardMarket(sub) {
  setRoute("markets");
  runMarkets(sub);
}

function bindNavigation() {
  $$("[data-route], [data-markets-sub], [data-macro-tab], [data-prediction-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (link.dataset.macroTab) {
        openMarkets("macro", false, link.dataset.macroTab);
        link.blur();
        return;
      }
      if (link.dataset.predictionTab) {
        openMarkets("prediction", false, link.dataset.predictionTab);
        link.blur();
        return;
      }
      if (link.dataset.marketsSub) {
        openMarkets(link.dataset.marketsSub, false, link.dataset.macroTab || null);
        link.blur();
        return;
      }
      if (link.dataset.route === "markets") {
        openMarkets(link.dataset.marketsSub || "most_active");
        link.blur();
        return;
      }
      setRoute(link.dataset.route);
      if (link.dataset.route === "dashboard") runDashboard();
      if (link.dataset.route === "chat") initChat();
      link.blur();
    });
  });
  $("#page-back-btn").addEventListener("click", goBackFromTicker);
}

function appendLlmMessage(role, content, streaming = false) {
  const msgs = $("#llm-messages");
  const div = document.createElement("div");
  div.className = `llm-msg ${role}`;
  const roleEl = document.createElement("span");
  roleEl.className = "llm-msg-role";
  roleEl.textContent = role === "user" ? "You" : role === "error" ? "Error" : "LLM";
  const bubble = document.createElement("div");
  bubble.className = "llm-msg-bubble";
  if (streaming || role !== "assistant") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "llm-cursor";
    bubble.appendChild(cursor);
  }
  div.appendChild(roleEl);
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}

async function streamLlmResponse(messages) {
  const { serverUrl } = loadLlmSettings();
  const url = `${serverUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const bubble = appendLlmMessage("assistant", "", true);
  let content = "";

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "local", messages, stream: true }),
    });
  } catch (err) {
    bubble.parentElement.remove();
    appendLlmMessage("error", `⚠ Could not reach LLM server. Check Settings.`);
    return "";
  }

  if (!res.ok) {
    res.body.cancel();
    bubble.parentElement.remove();
    appendLlmMessage("error", `⚠ LLM server returned HTTP ${res.status}. Check Settings.`);
    return "";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break outer;
      try {
        const obj = JSON.parse(raw);
        const token = obj.choices?.[0]?.delta?.content;
        if (token) {
          content += token;
          renderStreamingMarkdown(bubble, content);
          $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;
        }
      } catch { }
    }
  }

  reader.cancel();
  bubble.innerHTML = renderMarkdown(content);
  $("#llm-messages").scrollTop = $("#llm-messages").scrollHeight;
  return content;
}

async function sendLlmMessage() {
  const textarea = $("#llm-textarea");
  const userText = textarea.value.trim();
  if (!userText || state.llmStreaming) return;

  state.llmStreaming = true;
  textarea.value = "";
  textarea.style.height = "34px";
  $("#llm-send").disabled = true;

  state.llmHistory.push({ role: "user", content: userText });
  const userBubble = appendLlmMessage("user", userText);

  if (state.llmHistory.length > LLM_HISTORY_MAX) {
    state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
  }

  const systemMsg = { role: "system", content: buildSystemPrompt() };
  let apiHistory = state.llmHistory;
  if (state.llmWebSearch) {
    const webCtx = await fetchWebContext(userText);
    if (webCtx) {
      apiHistory = [...state.llmHistory.slice(0, -1), { role: "user", content: `${webCtx}\n\n---\n\n${userText}` }];
      userBubble?.closest(".llm-msg")?.classList.add("web-search");
    }
  }
  const messages = [systemMsg, ...apiHistory];

  try {
    const reply = await streamLlmResponse(messages);
    if (reply) {
      state.llmHistory.push({ role: "assistant", content: reply });
      if (state.llmHistory.length > LLM_HISTORY_MAX) {
        state.llmHistory = state.llmHistory.slice(-LLM_HISTORY_MAX);
      }
    }
  } catch (err) {
    appendLlmMessage("error", `⚠ ${err.message}`);
  } finally {
    state.llmStreaming = false;
    $("#llm-send").disabled = false;
    textarea.focus();
  }
}

function bindLlmSidebar() {
  // Populate settings input from localStorage on load
  $("#llm-server-url").value = loadLlmSettings().serverUrl;

  // Topbar button: toggle open/close
  $("#llm-btn").addEventListener("click", () => {
    if (state.llmOpen) closeLlmSidebar();
    else openLlmSidebar();
  });

  // Close button inside sidebar
  $("#llm-close-btn").addEventListener("click", closeLlmSidebar);

  // Backdrop click closes sidebar
  $("#llm-backdrop").addEventListener("click", closeLlmSidebar);

  // ESC key closes sidebar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.llmOpen) closeLlmSidebar();
  });

  // Gear → settings view
  $("#llm-settings-btn").addEventListener("click", () => {
    $("#llm-server-url").value = loadLlmSettings().serverUrl;
    $("#llm-conn-status").textContent = "—";
    $("#llm-conn-status").className = "llm-conn-status";
    showLlmView("settings");
  });

  // Back → chat view
  $("#llm-back-btn").addEventListener("click", () => showLlmView("chat"));

  // Save & Test Connection
  $("#llm-save-btn").addEventListener("click", async () => {
    const url = $("#llm-server-url").value.trim();
    const status = $("#llm-conn-status");
    if (!url) return;
    saveLlmSettings(url);
    status.textContent = "Testing…";
    status.className = "llm-conn-status";
    try {
      const model = await testLlmConnection(url);
      status.textContent = `● Connected · ${model}`;
      status.className = "llm-conn-status connected";
    } catch (err) {
      status.textContent = `✕ Unreachable — ${err.message}`;
      status.className = "llm-conn-status error";
    }
  });

  // Send button
  $("#llm-send").addEventListener("click", sendLlmMessage);

  // Web search toggle
  $("#llm-web-toggle")?.addEventListener("click", () => {
    state.llmWebSearch = !state.llmWebSearch;
    const btn = $("#llm-web-toggle");
    btn.classList.toggle("active", state.llmWebSearch);
    btn.setAttribute("aria-pressed", String(state.llmWebSearch));
  });

  // Enter sends, Shift+Enter inserts newline
  $("#llm-textarea").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendLlmMessage();
    }
  });

  // Auto-resize textarea as user types
  $("#llm-textarea").addEventListener("input", () => {
    const ta = $("#llm-textarea");
    ta.style.height = "34px";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  });

  // Restore saved sidebar width
  const savedWidth = localStorage.getItem("llm-sidebar-width");
  if (savedWidth) $("#llm-sidebar").style.width = savedWidth + "px";

  // Drag-to-resize handle
  const handle = $("#llm-resize-handle");
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const sidebar = $("#llm-sidebar");
    const onMove = (ev) => {
      const w = Math.min(700, Math.max(220, window.innerWidth - ev.clientX));
      sidebar.style.width = w + "px";
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      localStorage.setItem("llm-sidebar-width", parseInt($("#llm-sidebar").style.width));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

loadOptions().then(() => {
  loadWatchlists();
  bindNavigation();
  bindForms();
  bindOptionScreener();
  bindDashboard();
  bindMarkets();
  bindMacroMarkets();
  bindPredictionMarkets();
  bindTickerPage();
  bindIndicatorChips();
  bindCompareControls();
  bindLlmSidebar();
  bindChat();
  initSearch();
  initMarketStatus();
  renderWatchlists();

  const route = routeFromPath();
  if (route === "ticker") {
    const ticker = tickerFromPath();
    if (ticker) {
      void openTickerPage(ticker, ticker, {
        pushHistory: false,
        backPath: null,
        assetType: assetTypeFromPath(),
      });
    } else {
      setRoute("dashboard", true);
      runDashboard();
    }
  } else {
    setRoute(route, true);
    if (route === "dashboard") runDashboard();
    if (route === "markets") openMarkets(marketsSubFromPath() || "most_active", true, macroTabFromPath(), predictionTabFromPath());
    if (route === "chat") initChat();
  }

  window.addEventListener("popstate", (event) => {
    const r = routeFromPath();
    if (r === "ticker") {
      const ticker = tickerFromPath();
      if (ticker) {
        void openTickerPage(ticker, ticker, {
          pushHistory: false,
          backPath: event.state?.tickerBackPath || null,
          assetType: assetTypeFromPath(),
        });
      }
    } else {
      setRoute(r, true);
      if (r === "dashboard") runDashboard();
      if (r === "markets") openMarkets(marketsSubFromPath() || "most_active", true, macroTabFromPath(), predictionTabFromPath());
      if (r === "chat") initChat();
    }
  });

  window.addEventListener("pagehide", () => {
    if (state.chartLive || state.chartLivePendingStart) {
      sendLiveStopBeacon(state.chartLiveTicker || state.ticker);
    }
  });
});
