# Vite + React Dashboard — Design Spec

## Overview

Migrate the StockLens frontend from vanilla JS ES modules to Vite + React, starting with the Dashboard page. The Python `ThreadingHTTPServer` backend is unchanged. All existing `/api/*` endpoints are reused as-is.

The React app is a full SPA shell that handles all existing routes from day one. The Dashboard page is fully implemented; all other pages are placeholder stubs to be migrated incrementally.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Bundler | Vite |
| UI | React 19 |
| Routing | React Router v6 |
| Server state | TanStack Query v5 |
| Styling | CSS Modules + CSS custom properties |
| Language | JavaScript (JSX) |

---

## Project Structure

A new `frontend/` directory at the repo root contains the Vite project. The build output directory is set to `../ui/static`, so the Python server serves the built assets exactly as before.

```
frontend/
  index.html
  vite.config.js
  package.json
  src/
    main.jsx                  # Entry point; QueryClient + RouterProvider setup
    App.jsx                   # Shell: <Nav> + <Outlet>
    theme/
      tokens.css              # CSS custom properties — full dark indigo palette
    api/
      markets.js              # fetch('/api/markets?sub=...') wrapper
      indexes.js              # fetch('/api/dashboard-indexes') wrapper
      futures.js              # fetch('/api/dashboard-futures') wrapper
    hooks/
      useMarkets.js           # useQuery wrapper → api/markets
      useDashboardIndexes.js  # useQuery wrapper → api/indexes
      useDashboardFutures.js  # useQuery wrapper → api/futures
    components/
      Nav/
        Nav.jsx
        Nav.module.css
      IndexStrip/
        IndexStrip.jsx
        IndexStrip.module.css
      FuturesStrip/
        FuturesStrip.jsx
        FuturesStrip.module.css
      MarketCard/
        MarketCard.jsx
        MarketCard.module.css
    pages/
      Dashboard/
        Dashboard.jsx
        Dashboard.module.css
      Markets/
        Markets.jsx           # stub
      Ticker/
        Ticker.jsx            # stub
      Watchlist/
        Watchlist.jsx         # stub
      Screener/
        Screener.jsx          # stub
      Multi/
        Multi.jsx             # stub
      OptionScreener/
        OptionScreener.jsx    # stub
      Dcf/
        Dcf.jsx               # stub
      NodeGraph/
        NodeGraph.jsx         # stub
      PaperTrade/
        PaperTrade.jsx        # stub
      Chat/
        Chat.jsx              # stub
```

---

## Architecture

### Build & Dev Workflow

- **Dev:** `npm run dev` starts Vite on port 5173. `vite.config.js` proxies all `/api/*` requests to `http://localhost:8765` (Python server).
- **Production:** `npm run build` writes assets to `ui/static/`. Python server serves them as before via `uv run -m ui`.
- The existing `ui/static/` contents (vanilla JS files) are replaced by the Vite build output after the first build.

### Routing

React Router v6 with `createBrowserRouter`. Routes match the existing page paths exactly so bookmarks and the Python server's `PAGE_ROUTES` set remain valid:

```
/               → Dashboard
/dashboard      → Dashboard
/markets        → Markets (stub)
/ticker/:symbol → Ticker (stub)
/watchlist      → Watchlist (stub)
/screener       → Screener (stub)
/multi          → Multi (stub)
/option-screener → OptionScreener (stub)
/dcf            → Dcf (stub)
/node-graph     → NodeGraph (stub)
/paper-trade    → PaperTrade (stub)
/chat           → Chat (stub)
```

### QueryClient Configuration

```js
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,      // 1 min — matches existing client cache TTL
      refetchOnWindowFocus: true,
    },
  },
})
```

---

## Dashboard Page

### Sections (top to bottom)

1. **Page header** — "Market Pulse" title + date
2. **IndexStrip** — major indexes, refetches every 60s
3. **FuturesStrip** — futures & signals, refetches every 60s
4. **MarketCardGrid** — three `MarketCard` components side by side

### MarketCard

Props: `sub` (`"gainers"` | `"losers"` | `"unusual_volume"`), `onOpen` (navigate callback), `onAsk` (LLM quick-ask callback).

Fetches via `useMarkets(sub)`. Displays top 5 rows with ticker symbol and change value. Clicking the card body calls `onOpen(sub)`, navigating to `/markets?sub={sub}`. The `✦` button calls `onAsk(sub)` — wired to the existing `/api/chat/*` endpoints.

### IndexStrip / FuturesStrip

Horizontal scrolling strip of ticker chips. Each chip shows symbol, price, and change (green/red). Data from `/api/dashboard-indexes` and `/api/dashboard-futures` respectively. Both refetch every 60 seconds via `refetchInterval`.

---

## Theme

All color, spacing, and typography values are CSS custom properties defined in `theme/tokens.css` and applied globally. Components reference variables only — no hardcoded color values in component CSS files.

### Core tokens (Dark Indigo palette)

```css
:root {
  /* Backgrounds */
  --color-bg:          #0d0d14;
  --color-surface:     #1a1a2e;
  --color-surface-2:   #16213e;

  /* Borders */
  --color-border:      rgba(99, 102, 241, 0.15);
  --color-border-hover: rgba(99, 102, 241, 0.30);

  /* Accent */
  --accent-indigo:     #6366f1;
  --accent-indigo-dim: rgba(99, 102, 241, 0.08);
  --accent-violet:     #818cf8;

  /* Text */
  --text-primary:      #e2e8f0;
  --text-secondary:    #94a3b8;
  --text-muted:        #475569;

  /* Semantic */
  --color-gain:        #4ade80;
  --color-loss:        #f87171;
  --color-volume:      #fbbf24;

  /* Typography */
  --font-sans:         system-ui, -apple-system, sans-serif;
  --font-mono:         ui-monospace, monospace;

  /* Radii */
  --radius-sm:         6px;
  --radius-md:         10px;
  --radius-lg:         14px;
}
```

---

## Error Handling

- Each `useQuery` hook exposes `isLoading`, `isError`, and `error` states.
- Components render a skeleton placeholder while loading and an inline error message on failure — no full-page error boundaries needed for dashboard widgets.
- Network errors surface in-card (same UX as the existing `"Loading..."` / error states).

---

## Out of Scope

- Migrating any page other than Dashboard.
- TypeScript (can be adopted later without a rewrite).
- SSR / Next.js.
- Any changes to the Python backend.
- Unit or integration tests (can be added incrementally).
