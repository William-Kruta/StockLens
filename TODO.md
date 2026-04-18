# TODO

## Markets Page

Replace the "Single" tab with a "Markets" page (4 sub-tabs: Most Active, Trending, Top Gainers, Top Losers). Each sub-tab scrapes the corresponding Yahoo Finance URL and displays a clickable table — clicking a row opens that ticker's detail page.

Full spec: `docs/superpowers/specs/2026-04-16-markets-page-design.md`  
Full plan: `docs/superpowers/plans/2026-04-16-markets-page.md`

### Quickstart — execute the plan via subagent-driven development

The plan has 5 tasks. Run them in order from a feature branch (`.worktrees/` is already gitignored):

```bash
git worktree add .worktrees/feature/markets-page -b feature/markets-page
```

Then work from `.worktrees/feature/markets-page/`.

### Task summary

**Task 1 — `ui/server.py`**
- `import pandas as pd` (after `import polars as pl`, line 14)
- Add `_MARKETS_URLS` dict and `_markets(sub)` function before `API_HANDLERS` (line 344)
- Add `if path == "/api/markets":` block in `do_GET` after `/api/ticker-info` block (line 376), before the `PAGE_ROUTES` check
- Change `PAGE_ROUTES` (line 25): `/single` → `/markets`
- Remove `"/api/single": _single` from `API_HANDLERS` (line 345)

**Task 2 — `ui/static/index.html`**
- Brand link + nav link: `href="/markets"` `data-route="markets"` (was `single`)
- Replace `<section class="page" id="single-page">` (lines 135-173, the whole form block) with:
  ```html
  <section class="page" id="markets-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">Markets</p>
        <h1>Live market data from Yahoo Finance</h1>
      </div>
    </div>
    <div class="markets-tabs">
      <button class="markets-tab active" data-markets-sub="most_active">Most Active</button>
      <button class="markets-tab" data-markets-sub="trending">Trending</button>
      <button class="markets-tab" data-markets-sub="gainers">Top Gainers</button>
      <button class="markets-tab" data-markets-sub="losers">Top Losers</button>
    </div>
  </section>
  ```

**Task 3 — `ui/static/styles.css`**
- Add `.markets-tabs` / `.markets-tab` / `.markets-tab.active` styles (follow `.ticker-main-tab` pattern)

**Task 4 — `ui/static/app.js`**
- `state.route` (line 2): `"single"` → `"markets"`; add `marketsSub: "most_active"` to state object
- `buildLlmContext()` (line 120): replace `if (route === "single")` branch with `if (route === "markets")`; use `state.marketsSub.replace(/_/g, " ")` as description
- `routeFromPath()` (line 185): `|| "single"` → `|| "markets"`; replace `"single"` in valid-routes array with `"markets"`
- Add `runMarkets(sub)` function: updates active tab buttons, calls `setStatus("Loading…", false)`, fetches `/api/markets?sub=${sub}`, calls `renderTable(data.data)`, attaches row-click handlers reading `Symbol`/`Name` columns → `openTickerPage(symbol, name)`
- `bindForms()` (lines 1252-1267): remove the entire `#single-form` submit handler block
- `[data-example]` loop (line 1377): remove `if (example === "single") $("#single-form").requestSubmit();`
- Add `bindMarkets()` function: `$$(".markets-tab").forEach(btn => btn.addEventListener("click", () => runMarkets(btn.dataset.marketsSub)))`
- `loadOptions().then(...)` block (line 1590): add `bindMarkets();` call after `bindForms()`
- Initial route setup (line 1612): change fallback `setRoute("single", true)` → `setRoute("markets", true)`; after `setRoute(route, true)` in else branch (line 1615) add `if (route === "markets") runMarkets("most_active")`
- `popstate` handler else branch (line 1633): add `if (r === "markets") runMarkets(state.marketsSub || "most_active")`

**Task 5 — smoke test**
- Start server: `uv run python -m ui`
- Navigate to `/markets` — Most Active loads automatically, sub-tabs work, clicking a row opens ticker page
- Confirm `/single` returns 404
