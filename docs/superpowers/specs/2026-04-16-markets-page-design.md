# Markets Page — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Overview

Replace the "Single" nav item and page with a "Markets" page. Markets has four sub-tabs — Most Active, Trending, Top Gainers, Top Losers — each fetching live data from Yahoo Finance and displaying it as a clickable table. Clicking any ticker row opens that ticker's detail page.

---

## What's Removed

- `Single` nav link and `/single` route
- `#single-page` section in `index.html`
- `#single-form` submit handler in `app.js`
- `/api/single` route mapping in `server.py`
- `PAGE_ROUTES` entry for `/single`

The Single ticker analysis functionality remains accessible via the ticker detail page (Financials tab), which already provides the same data.

---

## Files Changed

| File | Change |
|------|--------|
| `ui/server.py` | Add `_markets(sub)`, add `/api/markets` GET endpoint, remove `/single` from `PAGE_ROUTES`, remove `/api/single` route |
| `ui/static/index.html` | Replace Single nav link + page section with Markets nav link + page section |
| `ui/static/app.js` | Add `runMarkets(sub)`, sub-tab bindings, row-click handler; remove single page logic |

---

## Data Layer

### URL mapping

```python
_MARKETS_URLS = {
    "most_active": "https://finance.yahoo.com/markets/stocks/most-active/",
    "trending":    "https://finance.yahoo.com/markets/stocks/trending/",
    "gainers":     "https://finance.yahoo.com/markets/stocks/gainers/",
    "losers":      "https://finance.yahoo.com/markets/stocks/losers/",
}
```

### Dependencies

`server.py` needs two additional imports: `import io` (stdlib) and `import pandas as pd` (`pandas` is already a transitive dependency via `yfinance`/`yahoors`).

### `_markets(sub: str) → dict`

```python
def _markets(sub: str) -> dict:
    url = _MARKETS_URLS.get(sub)
    if not url:
        raise ValueError(f"Unknown markets sub-tab: {sub}")
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ..."}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    tables = pd.read_html(io.StringIO(resp.text))
    if not tables:
        raise ValueError("No table found on page")
    df = tables[0]
    # Drop unnamed columns (chart sparklines)
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]
    title_map = {
        "most_active": "Most Active",
        "trending":    "Trending",
        "gainers":     "Top Gainers",
        "losers":      "Top Losers",
    }
    return {"title": title_map[sub], "data": _jsonable(df)}
```

### `/api/markets` endpoint

- Method: **GET**
- Query param: `?sub=most_active|trending|gainers|losers`
- Returns: `{"title": "...", "data": {"columns": [...], "rows": [...], "height": N, "width": N}}`
- On error: `{"error": "..."}`

---

## UI Behavior

### Nav

- "Single" link replaced with "Markets" link: `<a href="/markets" data-route="markets">Markets</a>`
- Route key: `"markets"` (replaces `"single"` in `PAGE_ROUTES` and JS `setRoute` logic)

### Markets page structure

```
┌─────────────────────────────────────────────┐
│ Markets                                      │  ← page heading
│ Live market data from Yahoo Finance          │
├──────────┬──────────┬────────────┬───────────┤
│Most Active│ Trending │Top Gainers │ Top Losers│  ← sub-tabs
├──────────┴──────────┴────────────┴───────────┤
│  [table renders here via renderTable()]      │
│  rows are clickable → openTickerPage()       │
└─────────────────────────────────────────────┘
```

### Sub-tab behavior

- Default sub-tab on page load / nav: **Most Active**
- Clicking a sub-tab: sets active class, calls `runMarkets(sub)`, shows loading state in status bar
- Active sub-tab stored in `state.marketsSub`

### `runMarkets(sub)`

```js
async function runMarkets(sub) {
    state.marketsSub = sub;
    // update active sub-tab button
    // show loading state
    const data = await fetch(`/api/markets?sub=${sub}`).then(r => r.json());
    // render title + table
    // make rows clickable: Symbol col → openTickerPage(symbol, name)
}
```

### Row click → ticker page

Each `<tbody tr>` gets a click handler that reads the `Symbol` and `Name` cell values and calls `openTickerPage(symbol, name)`. Rows get `cursor: pointer` and a hover highlight via existing table styles.

### Loading / error states

- Loading: existing `setStatus("Loading…", false)` pattern
- Error: existing `setStatus(err.message, true)` pattern
- Results section (`.results`) is shown/hidden using existing `.hidden` class pattern

---

## Route Handling

- `/markets` added to `PAGE_ROUTES` in `server.py`
- `/single` removed from `PAGE_ROUTES`
- JS `routeFromPath()` updated: `"markets"` replaces `"single"` in the valid-routes list, default route changes from `"single"` to `"markets"`
- On navigate to `/markets`: auto-runs `runMarkets("most_active")`

---

## Future Considerations (out of scope)

- Auto-refresh on a timer
- Additional sub-tabs (e.g. sector performance, crypto)
- Pagination for larger result sets
