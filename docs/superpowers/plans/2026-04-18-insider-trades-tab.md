# Insider Trades Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Insider Trades" tab to the ticker page that fetches and displays SEC Form 4 insider trading data via the `insidertracker` library.

**Architecture:** New GET endpoint `/api/insider-trades?ticker=X` in `server.py` calls `InsiderTracker().ticker.get_insider_trades(ticker)`, serializes the Polars DataFrame to JSON, and returns it. Frontend adds a fourth tab button, a new view div, and a `runTickerInsider()` function that fetches the endpoint and renders a color-coded table.

**Tech Stack:** Python (insidertracker, Polars), vanilla JS, existing server.py HTTP handler pattern.

---

### Task 1: Backend — `/api/insider-trades` endpoint

**Files:**
- Modify: `ui/server.py` (add import + helper function + GET handler)

- [ ] **Step 1: Add import at top of server.py**

Find the existing imports block (around line 1) and add:

```python
from insidertracker import InsiderTracker
```

- [ ] **Step 2: Add the helper function**

Add after the `_ticker_info` helper function (search for `def _ticker_info`). Insert the new function after it:

```python
def _insider_trades(ticker: str) -> dict:
    tracker = InsiderTracker()
    df = tracker.ticker.get_insider_trades(ticker)
    # Cast datetime/date columns to strings for JSON serialization
    import polars as pl
    df = df.with_columns([
        pl.col("filing_date").dt.strftime("%Y-%m-%d").alias("filing_date"),
        pl.col("trade_date").cast(pl.Utf8).alias("trade_date"),
    ])
    return {"rows": df.to_dicts()}
```

- [ ] **Step 3: Add the GET handler**

In `do_GET`, after the `/api/ticker-info` block (around line 1546), insert:

```python
        if path == "/api/insider-trades":
            ticker = parse_qs(parsed.query).get("ticker", [""])[0].strip().upper()
            if not ticker:
                self._send_json(
                    {"error": "ticker required"}, status=HTTPStatus.BAD_REQUEST
                )
                return
            try:
                self._send_json(_insider_trades(ticker))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
```

- [ ] **Step 4: Manually verify endpoint works**

Start the server and run:
```bash
uv run -m ui &
curl "http://localhost:8000/api/insider-trades?ticker=AAPL" | python3 -m json.tool | head -40
```
Expected: JSON with a `rows` key containing a list of dicts with keys: `filing_date`, `trade_date`, `ticker`, `insider_name`, `title`, `trade_type`, `price`, `quantity`, `owned`, `ownership_change`, `value`.

---

### Task 2: HTML — Add tab button and view div

**Files:**
- Modify: `ui/static/index.html`

- [ ] **Step 1: Add the tab button**

In the `.ticker-main-tabs` div (around line 69–73), add the new button after `info`:

```html
        <div class="ticker-main-tabs">
          <button class="ticker-main-tab active" data-main-tab="chart">Chart</button>
          <button class="ticker-main-tab" data-main-tab="financials">Financials</button>
          <button class="ticker-main-tab" data-main-tab="info">Info</button>
          <button class="ticker-main-tab" data-main-tab="insider">Insider Trades</button>
        </div>
```

- [ ] **Step 2: Add the view div**

After the `<!-- Info view -->` block (after line 145), insert before `</section>`:

```html
        <!-- Insider Trades view -->
        <div class="ticker-view" id="ticker-insider-view">
          <div id="ticker-insider-body">
            <div class="ticker-info-empty">Select a ticker to view insider trades.</div>
          </div>
        </div>
```

---

### Task 3: JS — Fetch function, renderer, and wiring

**Files:**
- Modify: `ui/static/app.js`

- [ ] **Step 1: Add `runTickerInsider` and `renderInsiderTrades` functions**

Insert after the `renderTickerInfo` function (after line ~2214):

```js
// Insider Trades tab
async function runTickerInsider() {
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

function renderInsiderTrades(rows, body) {
  if (!rows || rows.length === 0) {
    body.innerHTML = `<div class="ticker-info-empty">No insider trades found.</div>`;
    return;
  }

  const COLS = [
    { key: "filing_date",      label: "Filed" },
    { key: "trade_date",       label: "Trade Date" },
    { key: "insider_name",     label: "Insider" },
    { key: "title",            label: "Title" },
    { key: "trade_type",       label: "Type" },
    { key: "price",            label: "Price" },
    { key: "quantity",         label: "Qty" },
    { key: "owned",            label: "Owned" },
    { key: "ownership_change", label: "Chg %" },
    { key: "value",            label: "Value" },
  ];

  const fmtNum = (v) =>
    v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fmtMoney = (v) =>
    v == null ? "—" : "$" + Math.abs(Number(v)).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmtPct = (v) =>
    v == null ? "—" : (Number(v) * 100).toFixed(1) + "%";

  const head = COLS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");

  const bodyRows = rows.map((r) => {
    const isBuy = (r.trade_type || "").toLowerCase().includes("purchase") ||
                  (r.trade_type || "").toLowerCase().startsWith("p");
    const typeClass = isBuy ? "insider-buy" : "insider-sell";

    const cells = COLS.map((c) => {
      let val = r[c.key];
      if (c.key === "trade_type") {
        return `<td><span class="insider-type ${typeClass}">${escapeHtml(val ?? "—")}</span></td>`;
      }
      if (c.key === "price")            val = val == null ? "—" : "$" + fmtNum(val);
      else if (c.key === "quantity")    val = fmtNum(val);
      else if (c.key === "owned")       val = fmtNum(val);
      else if (c.key === "ownership_change") val = fmtPct(val);
      else if (c.key === "value")       val = fmtMoney(val);
      else                              val = val ?? "—";
      return `<td>${escapeHtml(String(val))}</td>`;
    }).join("");

    return `<tr>${cells}</tr>`;
  }).join("");

  body.innerHTML = `
    <div class="insider-table-wrap">
      <table class="insider-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}
```

- [ ] **Step 2: Wire up tab click in `bindTickerPage`**

In `bindTickerPage` (around line 2216), add the insider case:

```js
      if (tab === "chart") runTickerChart();
      if (tab === "financials") runTickerFinancials();
      if (tab === "info") runTickerInfo();
      if (tab === "insider") runTickerInsider();
```

- [ ] **Step 3: Wire up popstate handler**

In the `popstate` handler (around line 3122–3124), extend the else-if chain:

```js
        if (state.tickerMainTab === "financials") runTickerFinancials();
        else if (state.tickerMainTab === "info") runTickerInfo();
        else if (state.tickerMainTab === "insider") runTickerInsider();
        else runTickerChart();
```

---

### Task 4: CSS — Insider trade table styles

**Files:**
- Modify: `ui/static/styles.css`

- [ ] **Step 1: Add styles at end of file**

```css
/* Insider Trades tab */
.insider-table-wrap {
  overflow-x: auto;
  padding: 1rem;
}

.insider-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  font-family: var(--font-mono, monospace);
}

.insider-table th {
  text-align: left;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid #333;
  color: #888;
  font-weight: 600;
  white-space: nowrap;
}

.insider-table td {
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid #1a1a1a;
  white-space: nowrap;
}

.insider-table tbody tr:hover {
  background: #111;
}

.insider-type {
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
}

.insider-buy {
  background: rgba(0, 200, 100, 0.15);
  color: #00c864;
}

.insider-sell {
  background: rgba(255, 75, 75, 0.15);
  color: #ff4b4b;
}
```
