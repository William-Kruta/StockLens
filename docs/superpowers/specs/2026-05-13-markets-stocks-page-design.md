# Markets — Stocks Page Design Spec

## Overview

Implement the Markets page (`/markets`) for the Stocks sub-tabs in the Vite + React frontend. The page displays a full data table for one of eight stock market categories, selected via a sidebar. URL query param `?sub=` drives the active tab, keeping browser history and direct links working correctly.

---

## Tech Stack

Same as the existing frontend: React 19, React Router v6, TanStack Query v5 (existing `useMarkets` hook), CSS Modules, CSS custom properties (Dark Indigo theme).

---

## Supported Sub-tabs

| `sub` value | Label |
|---|---|
| `most_active` | Most Active |
| `gainers` | Top Gainers |
| `losers` | Top Losers |
| `trending` | Trending |
| `unusual_volume` | Unusual Volume |
| `small_cap` | Small Cap |
| `ipo` | IPO |
| `private_companies` | Private Companies |

Default sub when none is specified: `most_active`.

---

## Architecture

### URL State

The active sub-tab is read from `useSearchParams()`. Clicking a sidebar item calls `setSearchParams({ sub })`. This keeps the URL in sync so that:
- Browser back/forward navigates between sub-tabs
- Clicking a Dashboard MarketCard (`/markets?sub=gainers`) lands on the correct tab
- Direct links and bookmarks work

### Data

The existing `useMarkets(sub)` hook (at `frontend/src/hooks/useMarkets.js`) handles all data fetching. No new API or hook code required.

API response shape:
```json
{
  "title": "Top Gainers",
  "data": { "columns": ["Symbol", "Name", "Price", "Change", "Change %", "Volume"], "rows": [...], "height": 100, "width": 6 },
  "cache": { "status": "hit", "market_date": "2026-05-13", "age_seconds": 45 },
  "warning": null
}
```

### File Structure

```
frontend/src/pages/Markets/
  Markets.jsx          ← page component: sidebar layout + URL state
  Markets.module.css

frontend/src/components/MarketsTable/
  MarketsTable.jsx     ← reusable data table with clickable rows
  MarketsTable.module.css
```

---

## Component Design

### MarketsPage (`Markets.jsx`)

Reads `sub` from `useSearchParams()`, defaults to `"most_active"` if absent. Renders a two-column layout: fixed-width sidebar on the left, `<MarketsTable sub={sub} />` on the right.

**Sidebar** (inline, not a separate component): a vertical list of buttons, one per sub-tab. The active item gets indigo highlight styling. Clicking calls `setSearchParams({ sub: item.sub })`.

**Layout:** sidebar is `220px` wide, fixed. Content area takes remaining width. On viewports under `800px`, sidebar collapses to a horizontal scrollable strip above the table.

### MarketsTable (`MarketsTable.jsx`)

Props: `sub` (string).

Uses `useMarkets(sub)`. Renders:

1. **Loading state:** skeleton row placeholders (5 rows, full width)
2. **Error state:** inline error message
3. **Table:** all columns from `data.data.columns`, all rows from `data.data.rows`
   - `Symbol` column: run through `cleanSymbol()` to strip exchange prefix artifacts
   - Any column matching `/^change/i`: apply green (`--color-gain`) or red (`--color-loss`) text color based on the sign of the parsed numeric value
   - All other columns: plain text via `String(value ?? '')`
4. **Clickable rows:** each `<tr>` gets `cursor: pointer`. Clicking extracts the `Symbol` column value and calls `navigate('/ticker/:symbol')`
5. **Footer:** `{rowCount} tickers · {cacheNote}` — where `cacheNote` is `"market date {market_date}"` if present, else `"{status} cache, {age_seconds}s old"`. If `data.warning` is set, append ` · {warning}` in muted text.

---

## Theme

All styling uses existing CSS custom property tokens from `theme/tokens.css`. No new tokens needed.

Sidebar active item: `background: var(--accent-indigo-dim)`, `color: var(--accent-violet)`, left border `3px solid var(--accent-indigo)`.

Table: alternating row backgrounds via `nth-child` using `var(--color-surface)` / transparent. Header row uses `var(--text-muted)` labels. `Change %` values use `--color-gain` / `--color-loss`.

---

## Error Handling

- `isLoading`: show skeleton rows (5 placeholder rows matching column count)
- `isError`: show inline error message inside the table area — do not unmount the sidebar
- Empty rows (`data.data.rows.length === 0`): show "No data returned." message

---

## Out of Scope

- Macro sub-tabs (GDP, CPI, etc.)
- Prediction Markets sub-tabs
- Insider cluster buys
- Column sorting
- Pagination (the API returns up to 100 rows; all are shown)
- Search/filter within the table
