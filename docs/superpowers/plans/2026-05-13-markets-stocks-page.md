# Markets — Stocks Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/markets` stub page with a functional sidebar layout that displays any of eight stock-market data tables, driven by a `?sub=` URL query parameter.

**Architecture:** Two new files do the work — `MarketsTable` is a pure presentational component that accepts a `sub` prop, calls the existing `useMarkets(sub)` hook, and renders the table; `Markets` is the page component that reads `useSearchParams()`, owns the sidebar, and passes `sub` down. The existing `Markets.jsx` stub is replaced in-place; one new component directory is added for `MarketsTable`.

**Tech Stack:** React 19, React Router v6 `useSearchParams`, TanStack Query v5 (`useMarkets` hook already exists), CSS Modules, CSS custom properties (Dark Indigo tokens).

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `frontend/src/components/MarketsTable/MarketsTable.jsx` | Data table: loading skeleton, error, all columns, clickable rows, footer |
| Create | `frontend/src/components/MarketsTable/MarketsTable.module.css` | Table + skeleton styles |
| Replace | `frontend/src/pages/Markets/Markets.jsx` | Page: sidebar + URL state + renders MarketsTable |
| Create | `frontend/src/pages/Markets/Markets.module.css` | Sidebar layout styles |

No new API files, hooks, or backend changes needed — `useMarkets(sub)` at `frontend/src/hooks/useMarkets.js` already handles everything.

---

### Task 1: `MarketsTable` component — JSX

**Files:**
- Create: `frontend/src/components/MarketsTable/MarketsTable.jsx`

This component is the core of the feature. It must handle loading, error, empty, and populated states. Key behaviors:
- `cleanSymbol(value)` strips exchange prefix artifacts (e.g. `"N AAPL"` → `"AAPL"`)
- `parseSignedNumber(value)` parses numeric strings/numbers (handles commas, signs)
- Any column whose name matches `/^change/i` gets green (`--color-gain`) or red (`--color-loss`) text based on sign
- Each `<tr>` is clickable; clicking extracts the Symbol cell value and navigates to `/ticker/:symbol`
- Footer shows `{rowCount} tickers · {cacheNote}` — `cacheNote` is `"market date {market_date}"` if `cache.market_date` is set, else `"{status} cache, {age_seconds}s old"`. If `data.warning` is set, appends ` · {warning}` in muted text
- Loading state: 5 skeleton rows spanning all columns
- Error state: inline red message
- Empty state: "No data returned." message

- [ ] **Step 1: Create the file with helpers and skeleton**

Create `frontend/src/components/MarketsTable/MarketsTable.jsx`:

```jsx
import { useNavigate } from 'react-router-dom'
import { useMarkets } from '../../hooks/useMarkets'
import styles from './MarketsTable.module.css'

function cleanSymbol(value) {
  const str = String(value ?? '').trim()
  const parts = str.split(/\s+/)
  if (parts.length >= 2 && parts[0].length === 1) return parts[1]
  return parts[0] || ''
}

function parseSignedNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value == null) return null
  const match = String(value).replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function cellStyle(colName, value) {
  if (!/^change/i.test(colName)) return undefined
  const n = parseSignedNumber(value)
  if (n == null || n === 0) return undefined
  return { color: n > 0 ? 'var(--color-gain)' : 'var(--color-loss)' }
}

function formatCell(colName, value) {
  if (colName.toLowerCase() === 'symbol') return cleanSymbol(value)
  return String(value ?? '')
}

function buildCacheNote(cache) {
  if (!cache) return null
  if (cache.market_date) return `market date ${cache.market_date}`
  return `${cache.status} cache, ${cache.age_seconds}s old`
}

export default function MarketsTable({ sub }) {
  const { data, isLoading, isError, error } = useMarkets(sub)
  const navigate = useNavigate()

  const columns = data?.data?.columns ?? []
  const rows    = data?.data?.rows    ?? []
  const cache   = data?.cache         ?? null
  const warning = data?.warning       ?? null

  const symbolColIdx = columns.findIndex((c) => c.toLowerCase() === 'symbol')

  function handleRowClick(row) {
    if (symbolColIdx === -1) return
    const symbol = cleanSymbol(row[columns[symbolColIdx]])
    if (symbol) navigate(`/ticker/${symbol}`)
  }

  if (isLoading) {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className={styles.skeletonRow}>
                <td className={styles.skeletonCell} colSpan={6}>
                  <div className={styles.skeleton} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.tableWrap}>
        <p className={styles.errorMsg}>{error?.message ?? 'Failed to load data.'}</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <p className={styles.emptyMsg}>No data returned.</p>
      </div>
    )
  }

  const cacheNote = buildCacheNote(cache)

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} className={styles.th}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={styles.tr}
              onClick={() => handleRowClick(row)}
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className={styles.td}
                  style={cellStyle(col, row[col])}
                >
                  {formatCell(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.footer}>
        <span>{rows.length} tickers</span>
        {cacheNote && <span> · {cacheNote}</span>}
        {warning && <span className={styles.footerWarning}> · {warning}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file was created**

```bash
cat frontend/src/components/MarketsTable/MarketsTable.jsx | head -5
```

Expected: first line is `import { useNavigate } from 'react-router-dom'`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MarketsTable/MarketsTable.jsx
git commit -m "feat: add MarketsTable component"
```

---

### Task 2: `MarketsTable` CSS

**Files:**
- Create: `frontend/src/components/MarketsTable/MarketsTable.module.css`

- [ ] **Step 1: Create the CSS file**

Create `frontend/src/components/MarketsTable/MarketsTable.module.css`:

```css
.tableWrap {
  display: flex;
  flex-direction: column;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  font-family: var(--font-sans);
}

.th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  background: var(--color-surface);
  position: sticky;
  top: 0;
  z-index: 1;
}

.tr {
  cursor: pointer;
  transition: background 0.1s;
}

.tr:nth-child(odd) {
  background: var(--color-surface);
}

.tr:nth-child(even) {
  background: transparent;
}

.tr:hover {
  background: var(--accent-indigo-dim);
}

.td {
  padding: 0.45rem 0.75rem;
  color: var(--text-primary);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
}

/* Skeleton loading */
.skeletonRow td {
  padding: 0.5rem 0.75rem;
}

.skeleton {
  height: 1rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(
    90deg,
    var(--color-surface) 25%,
    var(--color-surface-2) 50%,
    var(--color-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.errorMsg {
  padding: 1.5rem;
  color: var(--color-loss);
  font-size: 0.875rem;
}

.emptyMsg {
  padding: 1.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.footer {
  padding: 0.625rem 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.footerWarning {
  color: var(--text-muted);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MarketsTable/MarketsTable.module.css
git commit -m "feat: add MarketsTable styles with shimmer skeleton"
```

---

### Task 3: `Markets` page — JSX

**Files:**
- Replace: `frontend/src/pages/Markets/Markets.jsx`

This replaces the single-line stub. The page owns the sidebar and URL state. Key behaviors:
- Reads `sub` from `useSearchParams()`, defaults to `"most_active"` if absent
- Clicking a sidebar item calls `setSearchParams({ sub: item.sub })`
- Active item gets distinct styling via a CSS class applied when `sub === item.sub`
- `<MarketsTable sub={sub} />` renders in the content area
- Below 800px the sidebar becomes a horizontal scrollable strip

Sub-tab definitions:
```js
const TABS = [
  { sub: 'most_active',       label: 'Most Active' },
  { sub: 'gainers',           label: 'Top Gainers' },
  { sub: 'losers',            label: 'Top Losers' },
  { sub: 'trending',          label: 'Trending' },
  { sub: 'unusual_volume',    label: 'Unusual Volume' },
  { sub: 'small_cap',         label: 'Small Cap' },
  { sub: 'ipo',               label: 'IPO' },
  { sub: 'private_companies', label: 'Private Companies' },
]
```

- [ ] **Step 1: Replace the stub file**

Replace `frontend/src/pages/Markets/Markets.jsx` with:

```jsx
import { useSearchParams } from 'react-router-dom'
import MarketsTable from '../../components/MarketsTable/MarketsTable'
import styles from './Markets.module.css'

const TABS = [
  { sub: 'most_active',       label: 'Most Active' },
  { sub: 'gainers',           label: 'Top Gainers' },
  { sub: 'losers',            label: 'Top Losers' },
  { sub: 'trending',          label: 'Trending' },
  { sub: 'unusual_volume',    label: 'Unusual Volume' },
  { sub: 'small_cap',         label: 'Small Cap' },
  { sub: 'ipo',               label: 'IPO' },
  { sub: 'private_companies', label: 'Private Companies' },
]

export default function Markets() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sub = searchParams.get('sub') ?? 'most_active'

  const activeTab = TABS.find((t) => t.sub === sub) ?? TABS[0]

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar}>
        {TABS.map((tab) => (
          <button
            key={tab.sub}
            className={`${styles.sidebarItem} ${tab.sub === sub ? styles.active : ''}`}
            onClick={() => setSearchParams({ sub: tab.sub })}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <section className={styles.content}>
        <h1 className={styles.heading}>{activeTab.label}</h1>
        <MarketsTable sub={sub} />
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file**

```bash
head -5 frontend/src/pages/Markets/Markets.jsx
```

Expected: first line is `import { useSearchParams } from 'react-router-dom'`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Markets/Markets.jsx
git commit -m "feat: implement Markets page with sidebar and URL-driven tab state"
```

---

### Task 4: `Markets` page CSS

**Files:**
- Create: `frontend/src/pages/Markets/Markets.module.css`

- [ ] **Step 1: Create the CSS file**

Create `frontend/src/pages/Markets/Markets.module.css`:

```css
.layout {
  display: flex;
  align-items: flex-start;
  height: calc(100vh - 56px); /* subtract nav height */
  overflow: hidden;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--color-border);
  height: 100%;
  overflow-y: auto;
}

.sidebarItem {
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.sidebarItem:hover {
  background: var(--accent-indigo-dim);
  color: var(--text-primary);
}

.sidebarItem.active {
  background: var(--accent-indigo-dim);
  color: var(--accent-violet);
  border-left: 3px solid var(--accent-indigo);
  padding-left: calc(0.75rem - 3px);
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.heading {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  padding: 1rem 1.25rem 0.5rem;
  flex-shrink: 0;
}

/* Responsive: collapse sidebar to horizontal strip below 800px */
@media (max-width: 800px) {
  .layout {
    flex-direction: column;
    height: auto;
    overflow: visible;
  }

  .sidebar {
    width: 100%;
    height: auto;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    padding: 0.5rem 0.75rem;
    gap: 4px;
    flex-wrap: nowrap;
  }

  .sidebarItem {
    white-space: nowrap;
    flex-shrink: 0;
  }

  .sidebarItem.active {
    border-left: none;
    border-bottom: 3px solid var(--accent-indigo);
    padding-left: 0.75rem;
    padding-bottom: calc(0.5rem - 3px);
  }

  .content {
    height: auto;
    overflow: visible;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Markets/Markets.module.css
git commit -m "feat: add Markets page layout styles with responsive sidebar"
```

---

### Task 5: Browser verification

No automated test framework is configured. Verify the feature manually in the dev server.

- [ ] **Step 1: Start the dev server**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/StockLens
./run.sh --dev
```

Expected: Python backend starts on `:8765`, Vite starts on `:5173`.

- [ ] **Step 2: Check Markets page loads**

Open `http://localhost:5173/markets` in a browser.

Expected:
- Sidebar shows 8 items (Most Active, Top Gainers, …, Private Companies)
- "Most Active" is highlighted with left indigo border
- Table loads (or shows shimmer skeleton briefly, then data)
- Footer shows e.g. `100 tickers · market date 2026-05-13`

- [ ] **Step 3: Check URL-driven tab switching**

Click "Top Gainers" in the sidebar.

Expected:
- URL changes to `/markets?sub=gainers`
- "Top Gainers" becomes active in sidebar
- Table re-fetches and shows gainers data
- Browser back button returns to Most Active with URL `/markets?sub=most_active`

- [ ] **Step 4: Check Dashboard card links**

Navigate to `/` (Dashboard).

Expected:
- Clicking a MarketCard body (e.g. "Gainers") navigates to `/markets?sub=gainers` with the correct tab pre-selected.

- [ ] **Step 5: Check direct URL navigation**

Navigate directly to `http://localhost:5173/markets?sub=unusual_volume`.

Expected:
- "Unusual Volume" is the active sidebar tab
- Correct table data loads

- [ ] **Step 6: Check responsive layout**

Resize browser to < 800px wide.

Expected:
- Sidebar becomes a horizontal scrollable strip above the table
- Active item shows bottom border instead of left border
- Table fills full width below the strip

- [ ] **Step 7: Check clickable rows**

Click any data row in the table.

Expected:
- URL navigates to `/ticker/{SYMBOL}` where `{SYMBOL}` is the cleaned symbol from that row (no exchange prefix)
- Ticker stub page renders (shows "coming soon" text)

- [ ] **Step 8: Check error state (optional)**

Stop the Python backend and refresh the Markets page.

Expected:
- Table area shows an inline red error message
- Sidebar remains visible and functional

