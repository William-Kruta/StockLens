import { state } from "/modules/state.js";
import { $ } from "/modules/dom.js";
import { escapeHtml } from "/modules/utils.js";
import { renderOptionsTable } from "/modules/optionsTable.js";

export async function runTickerInfo(forceRefresh = false) {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-info-body");
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const endpoint = state.assetType === "crypto" ? "crypto-info" : "ticker-info";
    const params = new URLSearchParams({ ticker });
    if (forceRefresh) params.set("refresh", "true");
    const res = await fetch(`/api/${endpoint}?${params.toString()}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (state.assetType === "crypto") renderCryptoInfo(data);
    else renderTickerInfo(data);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

export async function runCryptoAddresses() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-addresses-body");
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/crypto-addresses?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCryptoAddresses(data);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

export async function runTickerOptions() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-options-body");
  const maxDte = $("#ticker-options-fetch-dte")?.value || "30";
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/ticker-options?ticker=${encodeURIComponent(ticker)}&max_dte=${encodeURIComponent(maxDte)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderTickerOptions(data, body);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

export async function runTickerInsider() {
  const ticker = state.ticker;
  if (!ticker) return;
  const body = $("#ticker-insider-body");
  body.innerHTML = `<div class="ticker-info-empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/insider-trades?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderInsiderTrades(data.rows, body);
  } catch (err) {
    body.innerHTML = `<div class="ticker-info-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderTickerOptions(data, body) {
  renderOptionsTable(body, data);
}

function renderCryptoInfo(d) {
  const body = $("#ticker-info-body");
  const description = String(d.description || "").trim();
  const updatedAt = formatCryptoUpdatedAt(d.updated_at);
  const links = Array.isArray(d.links) ? d.links : [];
  const linksHtml = links.length
    ? `<div class="crypto-info-links">
        ${links.map((item) => `
          <a class="info-website" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener">
            ${escapeHtml(item.label || "Link")} ↗
          </a>
        `).join("")}
      </div>`
    : "";
  body.innerHTML = `
    <div class="info-card">
      <div class="info-header">
        <div class="info-header-left">
          <div class="info-company-name">${escapeHtml(d.name || d.symbol || "—")}</div>
          <div class="info-taxonomy">
            <span>Crypto</span>
            ${d.symbol ? `<span>${escapeHtml(d.symbol)}</span>` : ""}
          </div>
        </div>
        <div class="crypto-info-actions">
          <button
            class="crypto-info-refresh-btn"
            id="crypto-info-refresh-btn"
            type="button"
            aria-label="Refresh crypto info"
            title="Refresh"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          ${linksHtml}
        </div>
      </div>

      <div class="info-meta">
        <div class="info-meta-item">
          <span class="info-meta-label">Symbol</span>
          <span class="info-meta-value">${escapeHtml(d.symbol || "—")}</span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">CoinGecko ID</span>
          <span class="info-meta-value">${escapeHtml(d.id || "—")}</span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">Circulating Supply</span>
          <span class="info-meta-value">${escapeHtml(formatCryptoSupply(d.circulating_supply))}</span>
          ${updatedAt ? `<span class="crypto-info-note">Updated ${escapeHtml(updatedAt)}</span>` : ""}
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">Max Supply</span>
          <span class="info-meta-value">${escapeHtml(formatCryptoSupply(d.max_supply))}</span>
        </div>
      </div>

      ${description ? `
      <div>
        <div class="info-summary-label">Description</div>
        <p class="info-summary-text">${escapeHtml(description)}</p>
      </div>` : ""}
    </div>`;
  $("#crypto-info-refresh-btn")?.addEventListener("click", () => {
    runTickerInfo(true);
  });
}

function renderTickerInfo(d) {
  const body = $("#ticker-info-body");

  const firstTrade = d.first_trading_day
    ? new Date(d.first_trading_day).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "—";
  const isActive = d.trading_status === true || d.trading_status === "true";

  const websiteHtml = d.website
    ? `<a class="info-website" href="${escapeHtml(d.website)}" target="_blank" rel="noopener">
         ${escapeHtml(d.website.replace(/^https?:\/\//, ""))} ↗
       </a>`
    : "";

  const taxonomy = [d.sector, d.industry, d.country].filter(Boolean);

  body.innerHTML = `
    <div class="info-card">
      <div class="info-header">
        <div class="info-header-left">
          <div class="info-company-name">${escapeHtml(d.name || d.symbol || "—")}</div>
          <div class="info-taxonomy">
            ${taxonomy.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          </div>
        </div>
        <div class="info-header-actions">
          <button
            class="info-refresh-btn"
            id="ticker-info-refresh-btn"
            type="button"
            aria-label="Refresh stock info"
            title="Refresh"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          ${websiteHtml}
        </div>
      </div>

      <div class="info-meta">
        <div class="info-meta-item">
          <span class="info-meta-label">Symbol</span>
          <span class="info-meta-value">${escapeHtml(d.symbol || "—")}</span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">CEO</span>
          <span class="info-meta-value">${escapeHtml(d.ceo || "—")}</span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">Asset Type</span>
          <span class="info-meta-value">${escapeHtml(d.asset_type || "—")}</span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">Status</span>
          <span class="info-meta-value ${isActive ? "status-active" : "status-inactive"}">
            ${isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <div class="info-meta-item">
          <span class="info-meta-label">First Traded</span>
          <span class="info-meta-value">${escapeHtml(firstTrade)}</span>
        </div>
      </div>

      ${d.business_summary ? `
      <div>
        <div class="info-summary-label">About</div>
        <p class="info-summary-text">${escapeHtml(d.business_summary)}</p>
      </div>` : ""}
    </div>`;
  $("#ticker-info-refresh-btn")?.addEventListener("click", () => {
    runTickerInfo(true);
  });
}

function renderCryptoAddresses(payload) {
  const body = $("#ticker-addresses-body");
  const rows = payload?.rows || [];
  if (!rows.length) {
    body.innerHTML = `<div class="ticker-info-empty">No contract addresses found.</div>`;
    return;
  }

  body.innerHTML = `
    <div class="info-card">
      <div class="info-header">
        <div class="info-header-left">
          <div class="info-company-name">${escapeHtml(payload.name || payload.symbol || "Addresses")}</div>
          <div class="info-taxonomy">
            ${payload.symbol ? `<span>${escapeHtml(payload.symbol)}</span>` : ""}
            <span>${rows.length} ${rows.length === 1 ? "address" : "addresses"}</span>
          </div>
        </div>
      </div>
      <div class="options-table-wrap">
        <table class="options-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.chain || "—")}</td>
                <td class="crypto-address-cell">${escapeHtml(row.address || "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function formatCryptoSupply(value) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCryptoUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderInsiderTrades(rows, body) {
  if (!rows || rows.length === 0) {
    body.innerHTML = `<div class="ticker-info-empty">No insider trades found.</div>`;
    return;
  }

  const COLS = [
    { key: "filing_date", label: "Filed" },
    { key: "trade_date", label: "Trade Date" },
    { key: "insider_name", label: "Insider" },
    { key: "title", label: "Title" },
    { key: "trade_type", label: "Type" },
    { key: "price", label: "Price" },
    { key: "quantity", label: "Qty" },
    { key: "owned", label: "Owned" },
    { key: "ownership_change", label: "Chg %" },
    { key: "value", label: "Value" },
  ];

  const fmtNum = (v) => v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fmtMoney = (v) => v == null ? "—" : "$" + Math.abs(Number(v)).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmtPct = (v) => v == null ? "—" : (Number(v) * 100).toFixed(1) + "%";

  const isPurchase = (r) => {
    const t = (r.trade_type || "").toLowerCase();
    return t.includes("purchase") || t.startsWith("p");
  };

  function buildRows(subset) {
    return subset.map((r) => {
      const typeClass = isPurchase(r) ? "insider-buy" : "insider-sell";
      const cells = COLS.map((c) => {
        let val = r[c.key];
        if (c.key === "trade_type") {
          return `<td><span class="insider-type ${typeClass}">${escapeHtml(val ?? "—")}</span></td>`;
        }
        if (c.key === "price") val = val == null ? "—" : "$" + fmtNum(val);
        else if (c.key === "quantity") val = fmtNum(val);
        else if (c.key === "owned") val = fmtNum(val);
        else if (c.key === "ownership_change") val = fmtPct(val);
        else if (c.key === "value") val = fmtMoney(val);
        else val = val ?? "—";
        return `<td>${escapeHtml(String(val))}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
  }

  function buildSummary(subset, tradeFilter) {
    const count = subset.length;
    const net = subset.reduce((sum, r) => sum + (r.value ?? 0), 0);
    const isNeg = net < 0;
    const absFormatted = "$" + Math.abs(net).toLocaleString("en-US", { maximumFractionDigits: 0 });

    let valueLabel;
    let valueClass;
    let valueText;
    if (tradeFilter === "Purchases") {
      valueLabel = "Total Bought";
      valueClass = "insider-summary-pos";
      valueText = absFormatted;
    } else if (tradeFilter === "Sales") {
      valueLabel = "Total Sold";
      valueClass = "insider-summary-neg";
      valueText = absFormatted;
    } else {
      valueLabel = "Net";
      valueClass = isNeg ? "insider-summary-neg" : "insider-summary-pos";
      valueText = (isNeg ? "−" : "+") + absFormatted;
    }

    return `
      <span class="insider-summary-item"><span class="insider-summary-label">Trades</span><span class="insider-summary-value">${count}</span></span>
      <span class="insider-summary-sep"></span>
      <span class="insider-summary-item"><span class="insider-summary-label">${valueLabel}</span><span class="insider-summary-value ${valueClass}">${valueText}</span></span>`;
  }

  const titles = [...new Set(rows.map((r) => r.title).filter(Boolean))].sort();
  const titleOptions = ["All", ...titles]
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join("");

  const names = [...new Set(rows.map((r) => r.insider_name).filter(Boolean))].sort();
  const nameOptions = ["All", ...names]
    .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
    .join("");

  const head = COLS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");

  body.innerHTML = `
    <div class="insider-filter-bar">
      <label class="insider-filter-label">Title
        <select id="insider-title-filter">${titleOptions}</select>
      </label>
      <label class="insider-filter-label">Insider Name
        <select id="insider-name-filter">${nameOptions}</select>
      </label>
      <label class="insider-filter-label">Type
        <select id="insider-type-filter">
          <option value="All">All</option>
          <option value="Purchases">Purchases</option>
          <option value="Sales">Sales</option>
        </select>
      </label>
      <div class="insider-summary" id="insider-summary">${buildSummary(rows, "All")}</div>
    </div>
    <div class="insider-table-wrap">
      <table class="insider-table">
        <thead><tr>${head}</tr></thead>
        <tbody id="insider-tbody">${buildRows(rows)}</tbody>
      </table>
    </div>`;

  function applyFilters() {
    const titleVal = $("#insider-title-filter").value;
    const nameVal = $("#insider-name-filter").value;
    const typeVal = $("#insider-type-filter").value;
    const filtered = rows.filter((r) => {
      if (titleVal !== "All" && r.title !== titleVal) return false;
      if (nameVal !== "All" && r.insider_name !== nameVal) return false;
      if (typeVal === "Purchases" && !isPurchase(r)) return false;
      if (typeVal === "Sales" && isPurchase(r)) return false;
      return true;
    });
    $("#insider-tbody").innerHTML = buildRows(filtered);
    $("#insider-summary").innerHTML = buildSummary(filtered, typeVal);
  }

  $("#insider-title-filter").addEventListener("change", applyFilters);
  $("#insider-name-filter").addEventListener("change", applyFilters);
  $("#insider-type-filter").addEventListener("change", applyFilters);
}
