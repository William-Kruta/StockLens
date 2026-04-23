import { state } from "/modules/state.js";
import { $, $$ } from "/modules/dom.js";
import { setStatus } from "/modules/data.js";
import { escapeHtml } from "/modules/utils.js";

const CACHE_KEY = "kalshi:open-events";
const MAX_PAGES = 4;

const PREDICTION_TABS = [
  { key: "all", label: "All" },
  { key: "sports", label: "Sports" },
  { key: "crypto", label: "Crypto" },
  { key: "politics", label: "Politics" },
  { key: "economics", label: "Economics" },
  { key: "weather", label: "Weather" },
  { key: "technology", label: "Technology" },
  { key: "entertainment", label: "Entertainment" },
  { key: "energy", label: "Energy" },
  { key: "other", label: "Other" },
];

const TAB_HINTS = {
  sports: [
    "sport", "nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball",
    "baseball", "hockey", "golf", "tennis", "olympic", "olympics", "super bowl",
    "march madness", "world cup", "f1", "formula 1",
  ],
  crypto: [
    "crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp",
    "dogecoin", "doge", "blockchain", "stablecoin", "altcoin", "token",
  ],
  politics: [
    "politic", "election", "president", "white house", "congress", "senate",
    "house", "campaign", "trump", "biden", "harris", "democrat", "republican",
    "governor", "supreme court",
  ],
  economics: [
    "inflation", "cpi", "pce", "fed", "fomc", "rate", "rates", "gdp", "recession",
    "jobs", "jobless", "unemployment", "treasury", "yield", "macro", "economic",
    "employment", "payroll", "consumer price",
  ],
  weather: [
    "weather", "hurricane", "storm", "snow", "rain", "temperature", "climate",
    "heat", "flood", "tornado", "wildfire", "forecast", "blizzard",
  ],
  technology: [
    "technology", "tech", "ai", "artificial intelligence", "semiconductor", "chip",
    "chips", "nvidia", "apple", "microsoft", "google", "openai", "software",
    "internet", "cloud", "hardware",
  ],
  entertainment: [
    "entertainment", "movie", "film", "box office", "music", "tv", "television",
    "celebrity", "oscars", "grammy", "streaming", "netflix", "disney",
  ],
  energy: [
    "energy", "oil", "gas", "gasoline", "opec", "crude", "petroleum", "wti", "brent",
    "renewable", "solar", "wind", "power",
  ],
};
const LONG_MARKET_TITLE_THRESHOLD = 90;

let lastDataset = null;
let lastOptions = { clientCacheTtlMs: 60_000, forceRefresh: false };
let shellBound = false;

export async function runPredictionMarkets(tab = "all", options = {}) {
  const activeTab = normalizeTab(tab || state.marketsPredictionTab || "all");
  lastOptions = {
    clientCacheTtlMs: options.clientCacheTtlMs ?? lastOptions.clientCacheTtlMs,
    forceRefresh: Boolean(options.forceRefresh),
  };

  state.marketsSub = "prediction";
  state.marketsPredictionTab = activeTab;

  setPredictionShellVisible(true);
  renderPredictionTabs(activeTab);
  syncPredictionSearch();

  setStatus("Loading…", false);
  $("#result-title").textContent = "Prediction Markets";
  $("#result-table").innerHTML = "";
  $("#result-meta").textContent = "";
  $(".results")?.classList.add("hidden");

  try {
    lastDataset = await getPredictionDataset(lastOptions);
    renderPredictionView(lastDataset, activeTab);
  } catch (error) {
    renderPredictionError(error.message);
    setStatus(error.message, true);
  }
}

export function bindPredictionMarkets() {
  if (shellBound) return;
  shellBound = true;

  $("#markets-prediction-tabs")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-prediction-tab]");
    if (!btn) return;
    state.marketsPredictionTab = normalizeTab(btn.dataset.predictionTab);
    void runPredictionMarkets(state.marketsPredictionTab, lastOptions);
  });

  $("#markets-prediction-refresh")?.addEventListener("click", () => {
    void runPredictionMarkets(state.marketsPredictionTab || "all", {
      ...lastOptions,
      forceRefresh: true,
    });
  });

  $("#markets-prediction-search")?.addEventListener("input", (event) => {
    state.marketsPredictionQuery = event.target.value || "";
    if (lastDataset) renderPredictionView(lastDataset, state.marketsPredictionTab || "all");
  });

  $("#markets-prediction-events")?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-event-ticker]");
    if (!row) return;
    const ticker = row.dataset.eventTicker;
    const eventData = findEventInDataset(lastDataset, ticker);
    if (eventData) selectEvent(eventData, lastDataset);
  });

  $("#markets-prediction-markets")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-market-title-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const ticker = String(toggle.dataset.marketTitleToggle || "").trim();
      if (ticker) {
        if (!state.predictionMarketTitlesExpanded) state.predictionMarketTitlesExpanded = new Set();
        if (state.predictionMarketTitlesExpanded.has(ticker)) {
          state.predictionMarketTitlesExpanded.delete(ticker);
        } else {
          state.predictionMarketTitlesExpanded.add(ticker);
        }
        if (state.marketsPredictionSelectedEvent) {
          selectEvent(state.marketsPredictionSelectedEvent, lastDataset);
        }
      }
      return;
    }
    const row = event.target.closest("tr[data-market-ticker]");
    if (!row) return;
    const ticker = row.dataset.marketTicker;
    const eventData = state.marketsPredictionSelectedEvent
      ? findEventInDataset(lastDataset, state.marketsPredictionSelectedEvent.event_ticker)
      : null;
    if (!eventData) return;
    const market = (eventData.markets || []).find((item) => item.ticker === ticker);
    if (market) {
      state.marketsPredictionSelectedMarket = market.ticker;
      renderEventDetail(eventData);
      renderMarketDetail(market, eventData, true);
      syncMarketSelection(market.ticker);
    }
  });
}

export function setPredictionShellVisible(visible) {
  const shell = $("#markets-prediction-shell");
  if (!shell) return;
  shell.classList.toggle("hidden", !visible);
  if (!visible) {
    renderPredictionError("Select a prediction market category to load data.");
  }
}

function renderPredictionError(message) {
  const title = $("#markets-prediction-events-title");
  const meta = $("#markets-prediction-events-meta");
  const events = $("#markets-prediction-events");
  const eventTitle = $("#markets-prediction-event-title");
  const eventMeta = $("#markets-prediction-event-meta");
  const body = $("#markets-prediction-event-body");
  const detail = $("#markets-prediction-market-detail");
  const markets = $("#markets-prediction-markets");
  if (title) title.textContent = "Select a category";
  if (meta) meta.textContent = "";
  if (events) events.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
  if (eventTitle) eventTitle.textContent = "Select an event";
  if (eventMeta) eventMeta.textContent = "";
  if (body) body.innerHTML = `<div class="prediction-empty">${escapeHtml(message)}</div>`;
  if (detail) detail.innerHTML = "";
  if (markets) markets.innerHTML = "";
}

async function getPredictionDataset(options) {
  const cached = state.predictionMarketsCache.get(CACHE_KEY);
  if (cached && !options.forceRefresh && Date.now() - cached.fetchedAt < options.clientCacheTtlMs) {
    return cached.data;
  }

  const pages = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const params = new URLSearchParams({
      limit: "100",
      status: "open",
      with_nested_markets: "true",
      with_milestones: "true",
    });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/kalshi/events?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
    pages.push(data);
    cursor = data.cursor || null;
    if (!cursor) break;
  }

  const data = buildDataset(pages);
  state.predictionMarketsCache.set(CACHE_KEY, {
    fetchedAt: Date.now(),
    data,
  });
  return data;
}

function buildDataset(pages) {
  const events = new Map();
  const markets = new Map();

  pages.forEach((page) => {
    (page.events || []).forEach((event) => {
      const ticker = String(event.event_ticker || "").trim();
      if (!ticker) return;
      const current = events.get(ticker) || cloneEvent(event);
      events.set(ticker, mergeEvent(current, event));
      (event.markets || []).forEach((market) => addMarket(markets, ticker, market));
    });
    (page.markets || []).forEach((market) => addMarket(markets, market.event_ticker, market));
  });

  const normalizedEvents = [...events.values()]
    .map((event) => {
      const eventMarkets = dedupeMarkets(
        [
          ...(event.markets || []),
          ...(markets.get(event.event_ticker) || []),
        ]
      );
      const enrichedMarkets = eventMarkets
        .map(normalizeMarket)
        .filter((item) => item.ticker)
        .sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0) || (a.close_time || "").localeCompare(b.close_time || ""));
      return enrichEvent(event, enrichedMarkets);
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aClose = a.close_time || "";
      const bClose = b.close_time || "";
      return aClose.localeCompare(bClose) || (b.total_volume_fp || 0) - (a.total_volume_fp || 0);
    });

  const counts = countCategories(normalizedEvents);
  const totals = normalizedEvents.reduce((acc, event) => {
    acc.events += 1;
    acc.markets += event.markets_count;
    acc.volume_fp += event.total_volume_fp;
    acc.open_interest_fp += event.total_open_interest_fp;
    return acc;
  }, { events: 0, markets: 0, volume_fp: 0, open_interest_fp: 0 });

  return {
    fetched_at: new Date().toISOString(),
    events: normalizedEvents,
    counts,
    totals,
  };
}

function cloneEvent(event) {
  return {
    ...event,
    markets: [...(event.markets || [])],
  };
}

function mergeEvent(base, incoming) {
  const merged = { ...base, ...incoming };
  merged.markets = dedupeMarkets([...(base.markets || []), ...(incoming.markets || [])]);
  return merged;
}

function addMarket(store, eventTicker, market) {
  const ticker = String(eventTicker || market?.event_ticker || "").trim();
  if (!ticker || !market) return;
  const existing = store.get(ticker) || [];
  existing.push(market);
  store.set(ticker, dedupeMarkets(existing));
}

function dedupeMarkets(markets) {
  const seen = new Set();
  const result = [];
  markets.forEach((market) => {
    const ticker = String(market?.ticker || market?.market_ticker || "").trim();
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    result.push(market);
  });
  return result;
}

function normalizeMarket(market) {
  return {
    ...market,
    ticker: String(market?.ticker || market?.market_ticker || "").trim(),
    title: String(market?.title || "").trim(),
    event_ticker: String(market?.event_ticker || "").trim(),
    yes_bid: toNumber(market?.yes_bid_dollars ?? market?.yes?.bid),
    yes_ask: toNumber(market?.yes_ask_dollars ?? market?.yes?.ask),
    no_bid: toNumber(market?.no_bid_dollars ?? market?.no?.bid),
    no_ask: toNumber(market?.no_ask_dollars ?? market?.no?.ask),
    last_price: toNumber(market?.last_price_dollars ?? market?.last_price),
    volume_fp: toNumber(market?.volume_fp ?? market?.volume_24h_fp ?? market?.volume),
    open_interest_fp: toNumber(market?.open_interest_fp ?? market?.open_interest),
    close_time: String(market?.close_time || market?.close_ts || market?.expiration_time || market?.latest_expiration_time || "").trim(),
    updated_time: String(market?.updated_time || market?.updated_ts || market?.last_updated_ts || "").trim(),
    status: String(market?.status || "").trim(),
  };
}

function enrichEvent(event, markets) {
  const title = String(event.title || "").trim();
  const subTitle = String(event.sub_title || "").trim();
  const category = String(event.category || "").trim() || categorizeEventText(title, subTitle);
  const openMarkets = markets.filter((market) => /^(active|open)$/i.test(market.status || ""));
  const closeTime = markets
    .map((market) => market.close_time)
    .filter(Boolean)
    .sort()[0] || "";
  const updatedTime = [
    String(event.last_updated_ts || "").trim(),
    ...markets.map((market) => market.updated_time).filter(Boolean),
  ].sort().reverse()[0] || "";
  const totalVolumeFp = markets.reduce((sum, market) => sum + (market.volume_fp || 0), 0);
  const totalOpenInterestFp = markets.reduce((sum, market) => sum + (market.open_interest_fp || 0), 0);
  const searchText = `${title} ${subTitle} ${category} ${markets.map((market) => market.title).join(" ")}`.toLowerCase();

  return {
    ...event,
    title,
    sub_title: subTitle,
    category,
    category_key: resolveCategoryKey(searchText),
    markets,
    markets_count: markets.length,
    open_markets_count: openMarkets.length,
    close_time: closeTime,
    updated_time: updatedTime,
    total_volume_fp: totalVolumeFp,
    total_open_interest_fp: totalOpenInterestFp,
    search_text: searchText,
  };
}

function countCategories(events) {
  const counts = Object.fromEntries(PREDICTION_TABS.map((tab) => [tab.key, 0]));
  events.forEach((event) => {
    const key = event.category_key || "other";
    counts[key] = (counts[key] || 0) + 1;
    counts.all = (counts.all || 0) + 1;
  });
  return counts;
}

function resolveCategoryKey(text) {
  const lower = text.toLowerCase();
  for (const [key, hints] of Object.entries(TAB_HINTS)) {
    if (hints.some((hint) => lower.includes(hint))) return key;
  }
  return "other";
}

function categorizeEventText(title, subTitle) {
  return resolveCategoryKey(`${title} ${subTitle}`);
}

function renderPredictionView(dataset, activeTab) {
  const filteredEvents = filterEvents(dataset.events || [], activeTab, state.marketsPredictionQuery || "");
  renderPredictionTabs(activeTab, dataset.counts);
  renderPredictionStats(dataset, filteredEvents);
  renderPredictionEvents(filteredEvents, activeTab);
  syncPredictionSearch();

  if (!filteredEvents.length) {
    $("#markets-prediction-events-title").textContent = "No events";
    $("#markets-prediction-events-meta").textContent = "";
    $("#markets-prediction-events").innerHTML = `<div class="chart-empty">No matching prediction events.</div>`;
    $("#markets-prediction-event-title").textContent = "Select an event";
    $("#markets-prediction-event-meta").textContent = "";
    $("#markets-prediction-event-body").innerHTML = `<div class="prediction-empty">No matching prediction events.</div>`;
    $("#markets-prediction-market-detail").innerHTML = "";
    $("#markets-prediction-markets").innerHTML = "";
    state.marketsPredictionSelectedEvent = null;
    state.marketsPredictionSelectedMarket = null;
    setStatus("No matching prediction events.", true);
    return;
  }

  const selected = resolveSelectedEvent(filteredEvents);
  if (selected) selectEvent(selected, dataset);
  renderPredictionNavState(activeTab);
  const totalEvents = filteredEvents.length;
  const totalMarkets = filteredEvents.reduce((sum, event) => sum + event.markets_count, 0);
  setStatus(`${totalEvents} events · ${totalMarkets} markets`, false);
  $("#result-title").textContent = "Prediction Markets";
}

function resolveSelectedEvent(filteredEvents) {
  const selectedTicker = state.marketsPredictionSelectedEvent?.event_ticker;
  if (selectedTicker) {
    const match = filteredEvents.find((event) => event.event_ticker === selectedTicker);
    if (match) return match;
  }
  return filteredEvents[0] || null;
}

function selectEvent(event, dataset) {
  state.marketsPredictionSelectedEvent = event;
  const markets = event.markets || [];
  const selectedMarketTicker = state.marketsPredictionSelectedMarket && markets.some((market) => market.ticker === state.marketsPredictionSelectedMarket)
    ? state.marketsPredictionSelectedMarket
    : markets[0]?.ticker || null;
  state.marketsPredictionSelectedMarket = selectedMarketTicker;
  renderEventDetail(event);
  renderEventMarkets(event, selectedMarketTicker);
  if (selectedMarketTicker) {
    const market = markets.find((item) => item.ticker === selectedMarketTicker);
    if (market) renderMarketDetail(market, event, false);
  } else {
    renderEmptyMarketDetail();
  }
  syncEventSelection(event.event_ticker);
  syncMarketSelection(selectedMarketTicker);
  $("#markets-prediction-events-title").textContent = event.title || "Prediction Event";
  $("#markets-prediction-events-meta").textContent = `${event.markets_count} markets`;
}

function renderPredictionTabs(activeTab, counts = {}) {
  const tabs = $("#markets-prediction-tabs");
  if (!tabs) return;
  tabs.innerHTML = PREDICTION_TABS.map((tab) => {
    const active = tab.key === activeTab ? " active" : "";
    const count = counts[tab.key] ?? 0;
    return `<button class="markets-prediction-tab${active}" type="button" data-prediction-tab="${tab.key}">${escapeHtml(tab.label)}<span>${escapeHtml(String(count))}</span></button>`;
  }).join("");
  renderPredictionNavState(activeTab);
}

function renderPredictionNavState(activeTab) {
  $$(".nav-group-markets [data-prediction-tab]").forEach((link) => {
    link.classList.toggle("active", normalizeTab(link.dataset.predictionTab) === activeTab);
  });
}

function renderPredictionStats(dataset, filteredEvents) {
  const stats = $("#markets-prediction-stats");
  if (!stats) return;

  const totalEvents = filteredEvents.length;
  const totalMarkets = filteredEvents.reduce((sum, event) => sum + event.markets_count, 0);
  const totalVolume = filteredEvents.reduce((sum, event) => sum + event.total_volume_fp, 0);
  const topCategory = topCategoryFromEvents(filteredEvents);
  const topEvent = filteredEvents[0];

  stats.innerHTML = [
    statCard("Events", totalEvents),
    statCard("Markets", totalMarkets),
    statCard("Volume", formatLargeNumber(totalVolume)),
    statCard("Top Category", topCategory || "—"),
    statCard("Latest Event", topEvent?.title || "—"),
  ].join("");
}

function renderPredictionEvents(events, activeTab) {
  const container = $("#markets-prediction-events");
  if (!container) return;

  if (!events.length) {
    container.innerHTML = `<div class="chart-empty">No matching prediction events.</div>`;
    return;
  }

  const rows = events.map((event) => `
    <tr data-event-ticker="${escapeHtml(event.event_ticker)}" class="${state.marketsPredictionSelectedEvent?.event_ticker === event.event_ticker ? "active" : ""}">
      <td>
        <div class="prediction-event-title">${escapeHtml(event.title || event.event_ticker)}</div>
        <div class="prediction-event-subtitle">${escapeHtml(event.sub_title || event.series_ticker || "")}</div>
      </td>
      <td>${escapeHtml(event.category || event.category_key || "Other")}</td>
      <td>${escapeHtml(event.status || "open")}</td>
      <td>${escapeHtml(String(event.markets_count || 0))}</td>
      <td>${escapeHtml(formatLargeNumber(event.total_volume_fp || 0))}</td>
      <td>${escapeHtml(formatDateTime(event.close_time || event.last_updated_ts || event.updated_time || ""))}</td>
    </tr>`).join("");

  container.innerHTML = `
    <table class="prediction-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Category</th>
          <th>Status</th>
          <th>Markets</th>
          <th>Volume</th>
          <th>Close</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  syncEventSelection(state.marketsPredictionSelectedEvent?.event_ticker || events[0]?.event_ticker || null);
}

function renderEventDetail(event) {
  const body = $("#markets-prediction-event-body");
  if (!body) return;

  const markets = event.markets || [];
  const cards = [
    ["Category", event.category || event.category_key || "Other"],
    ["Markets", event.markets_count || 0],
    ["Active", event.open_markets_count || 0],
    ["Volume", formatLargeNumber(event.total_volume_fp || 0)],
    ["Open Interest", formatLargeNumber(event.total_open_interest_fp || 0)],
    ["Close", formatDateTime(event.close_time || event.last_updated_ts || event.updated_time || "")],
  ];

  body.innerHTML = `
    <div class="prediction-event-card">
      <div class="prediction-event-card-head">
        <div>
          <p class="eyebrow">Selected Event</p>
          <h4>${escapeHtml(event.title || event.event_ticker || "Prediction Event")}</h4>
        </div>
        <span>${escapeHtml(event.event_ticker || "")}</span>
      </div>
      <div class="prediction-summary-grid">
        ${cards.map(([label, value]) => `
          <div class="prediction-summary-item">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatDisplayValue(value))}</strong>
          </div>
        `).join("")}
      </div>
      <p class="prediction-event-copy">${escapeHtml(event.sub_title || event.title || "Select a market to inspect its orderbook.")}</p>
    </div>
  `;
}

function renderEventMarkets(event, activeMarketTicker) {
  const container = $("#markets-prediction-markets");
  if (!container) return;
  const markets = event.markets || [];
  if (!markets.length) {
    container.innerHTML = `<div class="chart-empty">No markets found for this event.</div>`;
    return;
  }

  const rows = markets.map((market) => `
    <tr data-market-ticker="${escapeHtml(market.ticker)}" class="${market.ticker === activeMarketTicker ? "active" : ""}">
      <td>
        ${renderMarketTitle(market.title || market.ticker, market.ticker)}
        <div class="prediction-market-subtitle">${escapeHtml(market.status || "active")}</div>
      </td>
      <td>${escapeHtml(formatPrice(market.yes_bid))}</td>
      <td>${escapeHtml(formatPrice(market.yes_ask))}</td>
      <td>${escapeHtml(formatPrice(market.no_bid))}</td>
      <td>${escapeHtml(formatPrice(market.no_ask))}</td>
      <td>${escapeHtml(formatPrice(market.last_price))}</td>
      <td>${escapeHtml(formatLargeNumber(market.volume_fp || 0))}</td>
      <td>${escapeHtml(formatLargeNumber(market.open_interest_fp || 0))}</td>
      <td>${escapeHtml(formatDateTime(market.close_time || ""))}</td>
    </tr>`).join("");

  container.innerHTML = `
    <table class="prediction-table">
      <thead>
        <tr>
          <th>Market</th>
          <th>Yes Bid</th>
          <th>Yes Ask</th>
          <th>No Bid</th>
          <th>No Ask</th>
          <th>Last</th>
          <th>Volume</th>
          <th>OI</th>
          <th>Close</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderMarketDetail(market, event, forceRefresh = false) {
  const detail = $("#markets-prediction-market-detail");
  if (!detail) return;
  const requestedTicker = market.ticker;
  const requestedEvent = event?.event_ticker || "";
  detail.innerHTML = `<div class="prediction-orderbook loading">Loading orderbook…</div>`;

  try {
    const marketData = await getMarketDetail(market.ticker, forceRefresh);
    const orderbook = await getMarketOrderbook(market.ticker, forceRefresh);
    if (
      state.marketsPredictionSelectedMarket !== requestedTicker
      || (state.marketsPredictionSelectedEvent?.event_ticker || "") !== requestedEvent
    ) {
      return;
    }
    const payload = marketData.market || marketData;
    detail.innerHTML = renderMarketDetailHtml(payload, orderbook, event);
  } catch (error) {
    if (
      state.marketsPredictionSelectedMarket !== requestedTicker
      || (state.marketsPredictionSelectedEvent?.event_ticker || "") !== requestedEvent
    ) {
      return;
    }
    detail.innerHTML = `<div class="prediction-orderbook error">${escapeHtml(error.message)}</div>`;
  }
}

function renderEmptyMarketDetail() {
  const detail = $("#markets-prediction-market-detail");
  if (!detail) return;
  detail.innerHTML = `<div class="prediction-orderbook empty">Select a market to inspect its orderbook.</div>`;
}

function renderMarketDetailHtml(market, orderbook, event) {
  const yesLevels = normalizeOrderbookSide(orderbook?.orderbook_fp?.yes_dollars || []);
  const noLevels = normalizeOrderbookSide(orderbook?.orderbook_fp?.no_dollars || []);
  return `
    <div class="prediction-market-card">
      <div class="prediction-market-card-head">
        <div>
          <p class="eyebrow">Selected Market</p>
          ${renderMarketTitle(market.title || market.ticker || "Market", market.ticker, true)}
        </div>
        <span>${escapeHtml(market.ticker || "")}</span>
      </div>
      <div class="prediction-summary-grid compact">
        <div class="prediction-summary-item"><span>Event</span><strong>${escapeHtml(event?.title || event?.event_ticker || "—")}</strong></div>
        <div class="prediction-summary-item"><span>Last</span><strong>${escapeHtml(formatPrice(market.last_price))}</strong></div>
        <div class="prediction-summary-item"><span>Yes Bid / Ask</span><strong>${escapeHtml(`${formatPrice(market.yes_bid)} / ${formatPrice(market.yes_ask)}`)}</strong></div>
        <div class="prediction-summary-item"><span>No Bid / Ask</span><strong>${escapeHtml(`${formatPrice(market.no_bid)} / ${formatPrice(market.no_ask)}`)}</strong></div>
      </div>
      <div class="prediction-orderbook-grid">
        <div class="prediction-orderbook-panel">
          <p class="eyebrow">Yes Orderbook</p>
          ${renderOrderbookLevels(yesLevels)}
        </div>
        <div class="prediction-orderbook-panel">
          <p class="eyebrow">No Orderbook</p>
          ${renderOrderbookLevels(noLevels)}
        </div>
      </div>
    </div>`;
}

function renderOrderbookLevels(levels) {
  if (!levels.length) return `<div class="prediction-orderbook empty">No orderbook data.</div>`;
  return `
    <table class="prediction-orderbook-table">
      <thead><tr><th>Price</th><th>Size</th></tr></thead>
      <tbody>
        ${levels.map((level) => `<tr><td>${escapeHtml(formatPrice(level.price))}</td><td>${escapeHtml(formatLargeNumber(level.size))}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function renderMarketTitle(title, ticker, isDetail = false) {
  const fullTitle = String(title || ticker || "Market").trim();
  const shouldToggle = fullTitle.length >= LONG_MARKET_TITLE_THRESHOLD;
  const expanded = Boolean(state.predictionMarketTitlesExpanded?.has(ticker));
  const wrapClass = `prediction-market-title-wrap${isDetail ? " detail" : ""}`;
  const textClass = `prediction-market-title-text${shouldToggle && !expanded ? " is-clamped" : ""}${expanded ? " is-expanded" : ""}`;

  if (!shouldToggle) {
    return `<div class="${wrapClass}"><div class="${textClass}">${escapeHtml(fullTitle)}</div></div>`;
  }

  return `
    <div class="${wrapClass}">
      <div class="${textClass}">${escapeHtml(fullTitle)}</div>
      <button
        class="prediction-market-title-toggle"
        type="button"
        data-market-title-toggle="${escapeHtml(ticker)}"
        aria-expanded="${expanded ? "true" : "false"}"
      >${expanded ? "▴" : "▾"}</button>
    </div>`;
}

async function getMarketDetail(ticker, forceRefresh = false) {
  const cacheKey = `market:${ticker}`;
  const cached = state.predictionMarketsCache.get(cacheKey);
  if (cached && !forceRefresh) return cached.data;
  const response = await fetch(`/api/kalshi/market?ticker=${encodeURIComponent(ticker)}${forceRefresh ? "&force_refresh=true" : ""}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  state.predictionMarketsCache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

async function getMarketOrderbook(ticker, forceRefresh = false) {
  const cacheKey = `orderbook:${ticker}`;
  const cached = state.predictionMarketsCache.get(cacheKey);
  if (cached && !forceRefresh) return cached.data;
  const response = await fetch(`/api/kalshi/orderbook?ticker=${encodeURIComponent(ticker)}${forceRefresh ? "&force_refresh=true" : ""}`);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  state.predictionMarketsCache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

function normalizeOrderbookSide(levels) {
  return (levels || [])
    .map(([price, size]) => ({
      price: toNumber(price),
      size: toNumber(size),
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
    .sort((a, b) => a.price - b.price);
}

function filterEvents(events, activeTab, query) {
  const q = String(query || "").trim().toLowerCase();
  return events.filter((event) => {
    if (activeTab !== "all" && event.category_key !== activeTab) return false;
    if (!q) return true;
    return [
      event.title,
      event.sub_title,
      event.category,
      event.event_ticker,
      event.series_ticker,
      ...(event.markets || []).map((market) => market.title),
    ].some((value) => String(value || "").toLowerCase().includes(q));
  });
}

function findEventInDataset(dataset, ticker) {
  return (dataset?.events || []).find((event) => event.event_ticker === ticker) || null;
}

function syncPredictionSearch() {
  const input = $("#markets-prediction-search");
  if (input && input.value !== (state.marketsPredictionQuery || "")) {
    input.value = state.marketsPredictionQuery || "";
  }
}

function syncEventSelection(ticker) {
  $$("#markets-prediction-events tbody tr").forEach((row) => {
    row.classList.toggle("active", row.dataset.eventTicker === ticker);
  });
}

function syncMarketSelection(ticker) {
  $$("#markets-prediction-markets tbody tr").forEach((row) => {
    row.classList.toggle("active", row.dataset.marketTicker === ticker);
  });
}

function topCategoryFromEvents(events) {
  const counts = new Map();
  events.forEach((event) => {
    const key = event.category || event.category_key || "Other";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} (${top[1]})` : "—";
}

function statCard(label, value) {
  return `
    <div class="prediction-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>`;
}

function normalizeTab(tab) {
  const normalized = String(tab || "all").trim().toLowerCase();
  if (PREDICTION_TABS.some((item) => item.key === normalized)) return normalized;
  return "all";
}

function formatPrice(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return "—";
  return `$${numeric.toFixed(2)}`;
}

function formatLargeNumber(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatLargeNumber(value);
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
