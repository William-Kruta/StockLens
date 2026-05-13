# Vite + React Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Vite + React SPA that serves all existing StockLens routes, with the Dashboard page fully implemented using the Dark Indigo theme.

**Architecture:** New `frontend/` directory at repo root; Vite build output to `../ui/static` so the Python `ThreadingHTTPServer` serves it unchanged. Dev mode runs Vite on port 5173 with an `/api/*` proxy to the Python server on port 8765. React Router v6 owns all client-side routing; TanStack Query v5 handles data fetching and caching for Dashboard widgets.

**Tech Stack:** Vite 6, React 19, React Router v6, TanStack Query v5, CSS Modules, CSS custom properties.

---

## File Map

```
frontend/
  index.html
  package.json
  vite.config.js
  src/
    main.jsx
    App.jsx
    App.module.css
    theme/
      tokens.css
      global.css
    api/
      markets.js
      indexes.js
      futures.js
    hooks/
      useMarkets.js
      useDashboardIndexes.js
      useDashboardFutures.js
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
      Chat/Chat.jsx
      Dcf/Dcf.jsx
      Markets/Markets.jsx
      Multi/Multi.jsx
      NodeGraph/NodeGraph.jsx
      OptionScreener/OptionScreener.jsx
      PaperTrade/PaperTrade.jsx
      Screener/Screener.jsx
      Ticker/Ticker.jsx
      Watchlist/Watchlist.jsx
```

---

## Task 1: Scaffold the Vite + React project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "stocklens-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.5"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../ui/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8765',
    },
  },
})
```

- [ ] **Step 3: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StockLens</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Install dependencies**

```bash
cd frontend && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Create a temporary `frontend/src/main.jsx` to verify Vite starts**

```jsx
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')).render(<h1>StockLens</h1>)
```

- [ ] **Step 6: Verify dev server starts**

Start the Python backend first:
```bash
cd /mnt/machine_learning/Coding/python/WebInterface/StockLens && uv run -m ui &
```

Then in `frontend/`:
```bash
npm run dev
```

Open `http://localhost:5173` — expect to see "StockLens" heading.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "scaffold: add Vite + React project"
```

---

## Task 2: Theme tokens and global CSS

**Files:**
- Create: `frontend/src/theme/tokens.css`
- Create: `frontend/src/theme/global.css`

- [ ] **Step 1: Create `frontend/src/theme/tokens.css`**

```css
:root {
  /* Backgrounds */
  --color-bg:           #0d0d14;
  --color-surface:      #1a1a2e;
  --color-surface-2:    #16213e;

  /* Borders */
  --color-border:       rgba(99, 102, 241, 0.15);
  --color-border-hover: rgba(99, 102, 241, 0.30);

  /* Accent */
  --accent-indigo:      #6366f1;
  --accent-indigo-dim:  rgba(99, 102, 241, 0.08);
  --accent-violet:      #818cf8;

  /* Text */
  --text-primary:       #e2e8f0;
  --text-secondary:     #94a3b8;
  --text-muted:         #475569;

  /* Semantic */
  --color-gain:         #4ade80;
  --color-loss:         #f87171;
  --color-volume:       #fbbf24;

  /* Typography */
  --font-sans:          system-ui, -apple-system, sans-serif;
  --font-mono:          ui-monospace, monospace;

  /* Radii */
  --radius-sm:          6px;
  --radius-md:          10px;
  --radius-lg:          14px;
}
```

- [ ] **Step 2: Create `frontend/src/theme/global.css`**

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}

body {
  background: var(--color-bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  min-height: 100vh;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
}
```

- [ ] **Step 3: Update `frontend/src/main.jsx` to import theme files**

```jsx
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './theme/global.css'
createRoot(document.getElementById('root')).render(<h1 style={{ color: 'var(--text-primary)', padding: '2rem' }}>StockLens</h1>)
```

- [ ] **Step 4: Verify in browser**

`http://localhost:5173` — page background should be `#0d0d14` (very dark blue-black) with white "StockLens" text.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme/
git commit -m "feat: add dark indigo theme tokens and global CSS reset"
```

---

## Task 3: App shell, Nav, stub pages, and router

**Files:**
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/App.module.css`
- Create: `frontend/src/components/Nav/Nav.jsx`
- Create: `frontend/src/components/Nav/Nav.module.css`
- Create: `frontend/src/pages/Chat/Chat.jsx`
- Create: `frontend/src/pages/Dcf/Dcf.jsx`
- Create: `frontend/src/pages/Markets/Markets.jsx`
- Create: `frontend/src/pages/Multi/Multi.jsx`
- Create: `frontend/src/pages/NodeGraph/NodeGraph.jsx`
- Create: `frontend/src/pages/OptionScreener/OptionScreener.jsx`
- Create: `frontend/src/pages/PaperTrade/PaperTrade.jsx`
- Create: `frontend/src/pages/Screener/Screener.jsx`
- Create: `frontend/src/pages/Ticker/Ticker.jsx`
- Create: `frontend/src/pages/Watchlist/Watchlist.jsx`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Create all stub pages**

Each file follows the same pattern. Create each one:

`frontend/src/pages/Chat/Chat.jsx`:
```jsx
export default function Chat() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Chat — coming soon.</div>
}
```

`frontend/src/pages/Dcf/Dcf.jsx`:
```jsx
export default function Dcf() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>DCF — coming soon.</div>
}
```

`frontend/src/pages/Markets/Markets.jsx`:
```jsx
export default function Markets() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Markets — coming soon.</div>
}
```

`frontend/src/pages/Multi/Multi.jsx`:
```jsx
export default function Multi() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Compare — coming soon.</div>
}
```

`frontend/src/pages/NodeGraph/NodeGraph.jsx`:
```jsx
export default function NodeGraph() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Node Graph — coming soon.</div>
}
```

`frontend/src/pages/OptionScreener/OptionScreener.jsx`:
```jsx
export default function OptionScreener() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Option Screener — coming soon.</div>
}
```

`frontend/src/pages/PaperTrade/PaperTrade.jsx`:
```jsx
export default function PaperTrade() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Paper Trade — coming soon.</div>
}
```

`frontend/src/pages/Screener/Screener.jsx`:
```jsx
export default function Screener() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Screener — coming soon.</div>
}
```

`frontend/src/pages/Ticker/Ticker.jsx`:
```jsx
import { useParams } from 'react-router-dom'
export default function Ticker() {
  const { symbol } = useParams()
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>{symbol} — coming soon.</div>
}
```

`frontend/src/pages/Watchlist/Watchlist.jsx`:
```jsx
export default function Watchlist() {
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Watchlist — coming soon.</div>
}
```

- [ ] **Step 2: Create `frontend/src/components/Nav/Nav.module.css`**

```css
.nav {
  display: flex;
  align-items: center;
  gap: 0;
  height: 52px;
  padding: 0 1.5rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.brand {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
  margin-right: 2rem;
  flex-shrink: 0;
}

.links {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
}

.link {
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s;
}

.link:hover {
  color: var(--text-primary);
  background: var(--accent-indigo-dim);
}

.link.active {
  color: var(--accent-violet);
  background: var(--accent-indigo-dim);
}

.dropdown {
  position: relative;
}

.dropdownToggle {
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.dropdownToggle:hover {
  color: var(--text-primary);
  background: var(--accent-indigo-dim);
}

.dropdownMenu {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 160px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.375rem;
  z-index: 200;
}

.dropdown:hover .dropdownMenu {
  display: block;
}

.dropdownItem {
  display: block;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  transition: color 0.15s, background 0.15s;
}

.dropdownItem:hover {
  color: var(--text-primary);
  background: var(--accent-indigo-dim);
}
```

- [ ] **Step 3: Create `frontend/src/components/Nav/Nav.jsx`**

```jsx
import { NavLink } from 'react-router-dom'
import styles from './Nav.module.css'

export default function Nav() {
  const linkClass = ({ isActive }) =>
    isActive ? `${styles.link} ${styles.active}` : styles.link

  return (
    <header className={styles.nav}>
      <NavLink to="/dashboard" className={styles.brand}>
        StockLens
      </NavLink>
      <div className={styles.links}>
        <NavLink to="/dashboard" className={linkClass}>
          Dashboard
        </NavLink>
        <div className={styles.dropdown}>
          <button className={styles.dropdownToggle}>Markets ▾</button>
          <div className={styles.dropdownMenu}>
            <NavLink to="/markets?sub=most_active" className={styles.dropdownItem}>Most Active</NavLink>
            <NavLink to="/markets?sub=gainers" className={styles.dropdownItem}>Top Gainers</NavLink>
            <NavLink to="/markets?sub=losers" className={styles.dropdownItem}>Top Losers</NavLink>
            <NavLink to="/markets?sub=trending" className={styles.dropdownItem}>Trending</NavLink>
            <NavLink to="/markets?sub=unusual_volume" className={styles.dropdownItem}>Unusual Volume</NavLink>
          </div>
        </div>
        <div className={styles.dropdown}>
          <button className={styles.dropdownToggle}>Tools ▾</button>
          <div className={styles.dropdownMenu}>
            <NavLink to="/chat" className={styles.dropdownItem}>Chat</NavLink>
            <NavLink to="/multi" className={styles.dropdownItem}>Compare</NavLink>
            <NavLink to="/dcf" className={styles.dropdownItem}>DCF</NavLink>
            <NavLink to="/watchlist" className={styles.dropdownItem}>Watchlist</NavLink>
            <NavLink to="/screener" className={styles.dropdownItem}>Screener</NavLink>
            <NavLink to="/option-screener" className={styles.dropdownItem}>Option Screener</NavLink>
            <NavLink to="/paper-trade" className={styles.dropdownItem}>Paper Trade</NavLink>
            <NavLink to="/node-graph" className={styles.dropdownItem}>Node Graph</NavLink>
          </div>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create `frontend/src/App.module.css`**

```css
.main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}
```

- [ ] **Step 5: Create `frontend/src/App.jsx`**

```jsx
import { Outlet } from 'react-router-dom'
import Nav from './components/Nav/Nav'
import styles from './App.module.css'

export default function App() {
  return (
    <>
      <Nav />
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  )
}
```

- [ ] **Step 6: Replace `frontend/src/main.jsx` with full router setup**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import Chat from './pages/Chat/Chat'
import Dcf from './pages/Dcf/Dcf'
import Markets from './pages/Markets/Markets'
import Multi from './pages/Multi/Multi'
import NodeGraph from './pages/NodeGraph/NodeGraph'
import OptionScreener from './pages/OptionScreener/OptionScreener'
import PaperTrade from './pages/PaperTrade/PaperTrade'
import Screener from './pages/Screener/Screener'
import Ticker from './pages/Ticker/Ticker'
import Watchlist from './pages/Watchlist/Watchlist'
import './theme/tokens.css'
import './theme/global.css'

// Dashboard import is a placeholder — will be created in Task 8
const Dashboard = () => <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Dashboard — coming soon.</div>

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    },
  },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'markets', element: <Markets /> },
      { path: 'ticker/:symbol', element: <Ticker /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'screener', element: <Screener /> },
      { path: 'multi', element: <Multi /> },
      { path: 'option-screener', element: <OptionScreener /> },
      { path: 'dcf', element: <Dcf /> },
      { path: 'node-graph', element: <NodeGraph /> },
      { path: 'paper-trade', element: <PaperTrade /> },
      { path: 'chat', element: <Chat /> },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
```

- [ ] **Step 7: Verify routing works**

Open `http://localhost:5173`. Check:
- Nav renders with dark indigo background
- Clicking "Markets" in the Tools dropdown navigates to `/markets` and shows "Markets — coming soon."
- `http://localhost:5173/ticker/AAPL` shows "AAPL — coming soon."
- `http://localhost:5173/dashboard` shows "Dashboard — coming soon."

- [ ] **Step 8: Commit**

```bash
git add frontend/src/
git commit -m "feat: add app shell, nav, stub pages, and router"
```

---

## Task 4: API fetch functions and TanStack Query hooks

**Files:**
- Create: `frontend/src/api/markets.js`
- Create: `frontend/src/api/indexes.js`
- Create: `frontend/src/api/futures.js`
- Create: `frontend/src/hooks/useMarkets.js`
- Create: `frontend/src/hooks/useDashboardIndexes.js`
- Create: `frontend/src/hooks/useDashboardFutures.js`

API response shapes (from existing server):
- `/api/markets?sub=...` → `{ data: { columns: string[], rows: object[], height: number, width: number }, cache: {...} }`
- `/api/dashboard-indexes` → `{ indexes: [{ name, symbol, change_pct, close }], cache: { status, age_seconds } }`
- `/api/dashboard-futures` → `{ items: [{ name, symbol, change_pct, close }], cache: { status, age_seconds } }`

- [ ] **Step 1: Create `frontend/src/api/markets.js`**

```js
export async function fetchMarkets(sub) {
  const res = await fetch(`/api/markets?sub=${encodeURIComponent(sub)}`)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
```

- [ ] **Step 2: Create `frontend/src/api/indexes.js`**

```js
export async function fetchDashboardIndexes() {
  const res = await fetch('/api/dashboard-indexes')
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
```

- [ ] **Step 3: Create `frontend/src/api/futures.js`**

```js
export async function fetchDashboardFutures() {
  const res = await fetch('/api/dashboard-futures')
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
```

- [ ] **Step 4: Create `frontend/src/hooks/useMarkets.js`**

```js
import { useQuery } from '@tanstack/react-query'
import { fetchMarkets } from '../api/markets'

export function useMarkets(sub) {
  return useQuery({
    queryKey: ['markets', sub],
    queryFn: () => fetchMarkets(sub),
    refetchInterval: 60_000,
  })
}
```

- [ ] **Step 5: Create `frontend/src/hooks/useDashboardIndexes.js`**

```js
import { useQuery } from '@tanstack/react-query'
import { fetchDashboardIndexes } from '../api/indexes'

export function useDashboardIndexes() {
  return useQuery({
    queryKey: ['dashboard-indexes'],
    queryFn: fetchDashboardIndexes,
    refetchInterval: 60_000,
  })
}
```

- [ ] **Step 6: Create `frontend/src/hooks/useDashboardFutures.js`**

```js
import { useQuery } from '@tanstack/react-query'
import { fetchDashboardFutures } from '../api/futures'

export function useDashboardFutures() {
  return useQuery({
    queryKey: ['dashboard-futures'],
    queryFn: fetchDashboardFutures,
    refetchInterval: 60_000,
  })
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/ frontend/src/hooks/
git commit -m "feat: add API fetch functions and TanStack Query hooks"
```

---

## Task 5: IndexStrip component

**Files:**
- Create: `frontend/src/components/IndexStrip/IndexStrip.jsx`
- Create: `frontend/src/components/IndexStrip/IndexStrip.module.css`

The `/api/dashboard-indexes` response has shape: `{ indexes: [{ name: string, symbol: string, change_pct: number | null, close: number | null }], cache: { status: string, age_seconds: number } }`.

- [ ] **Step 1: Create `frontend/src/components/IndexStrip/IndexStrip.module.css`**

```css
.section {
  margin-bottom: 2rem;
}

.header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 0.125rem;
}

.meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.strip {
  display: flex;
  gap: 0.625rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.strip::-webkit-scrollbar {
  display: none;
}

.tile {
  flex-shrink: 0;
  background: linear-gradient(145deg, var(--color-surface), var(--color-surface-2));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  min-width: 110px;
}

.tileName {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.25rem;
  white-space: nowrap;
}

.tileSymbol {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 0.375rem;
  font-family: var(--font-mono);
}

.tileChange {
  font-size: 0.875rem;
  font-weight: 600;
  font-family: var(--font-mono);
}

.gain { color: var(--color-gain); }
.loss { color: var(--color-loss); }
.neutral { color: var(--text-secondary); }

.loading {
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding: 0.5rem 0;
}

.error {
  font-size: 0.8125rem;
  color: var(--color-loss);
  padding: 0.5rem 0;
}
```

- [ ] **Step 2: Create `frontend/src/components/IndexStrip/IndexStrip.jsx`**

```jsx
import { useDashboardIndexes } from '../../hooks/useDashboardIndexes'
import styles from './IndexStrip.module.css'

function formatChange(change_pct) {
  if (change_pct == null) return '—'
  const sign = change_pct >= 0 ? '+' : ''
  return `${sign}${change_pct.toFixed(2)}%`
}

function changeClass(change_pct) {
  if (change_pct == null || change_pct === 0) return styles.neutral
  return change_pct > 0 ? styles.gain : styles.loss
}

export default function IndexStrip() {
  const { data, isLoading, isError, error } = useDashboardIndexes()

  const cacheNote = data?.cache
    ? `${data.cache.status} cache · ${data.cache.age_seconds}s old`
    : 'Latest close'

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <p className={styles.label}>Today</p>
          <h2 className={styles.title}>Major indexes</h2>
        </div>
        <span className={styles.meta}>{isLoading ? 'Loading…' : isError ? 'Unavailable' : cacheNote}</span>
      </div>
      <div className={styles.strip}>
        {isLoading && <span className={styles.loading}>Loading…</span>}
        {isError && <span className={styles.error}>{error.message}</span>}
        {data?.indexes?.map((item) => (
          <div key={item.symbol} className={styles.tile}>
            <div className={styles.tileName}>{item.name}</div>
            <div className={styles.tileSymbol}>{item.symbol}</div>
            <div className={`${styles.tileChange} ${changeClass(item.change_pct)}`}>
              {formatChange(item.change_pct)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Verify IndexStrip in isolation**

Temporarily add it to the Dashboard stub in `main.jsx`:
```jsx
import IndexStrip from './components/IndexStrip/IndexStrip'
const Dashboard = () => <div style={{ padding: '2rem' }}><IndexStrip /></div>
```

Open `http://localhost:5173/dashboard`. With the Python server running, you should see index tiles with names, symbols, and colored change percentages.

- [ ] **Step 4: Revert the temporary Dashboard stub in `main.jsx`**

Change Dashboard back to:
```jsx
const Dashboard = () => <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Dashboard — coming soon.</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/IndexStrip/
git commit -m "feat: add IndexStrip component"
```

---

## Task 6: FuturesStrip component

**Files:**
- Create: `frontend/src/components/FuturesStrip/FuturesStrip.jsx`
- Create: `frontend/src/components/FuturesStrip/FuturesStrip.module.css`

The `/api/dashboard-futures` response has shape: `{ items: [{ name: string, symbol: string, change_pct: number | null, close: number | null }], cache: { status: string, age_seconds: number } }`.

- [ ] **Step 1: Create `frontend/src/components/FuturesStrip/FuturesStrip.module.css`**

```css
.section {
  margin-bottom: 2.5rem;
}

.header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 0.125rem;
}

.meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.strip {
  display: flex;
  gap: 0.625rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.strip::-webkit-scrollbar {
  display: none;
}

.tile {
  flex-shrink: 0;
  background: var(--accent-indigo-dim);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  min-width: 120px;
}

.tileName {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.25rem;
  white-space: nowrap;
}

.tileSymbol {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 0.125rem;
  font-family: var(--font-mono);
}

.tilePrice {
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  margin-bottom: 0.25rem;
}

.tileChange {
  font-size: 0.875rem;
  font-weight: 600;
  font-family: var(--font-mono);
}

.gain { color: var(--color-gain); }
.loss { color: var(--color-loss); }
.neutral { color: var(--text-secondary); }

.loading {
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding: 0.5rem 0;
}

.error {
  font-size: 0.8125rem;
  color: var(--color-loss);
  padding: 0.5rem 0;
}
```

- [ ] **Step 2: Create `frontend/src/components/FuturesStrip/FuturesStrip.jsx`**

```jsx
import { useDashboardFutures } from '../../hooks/useDashboardFutures'
import styles from './FuturesStrip.module.css'

function formatChange(change_pct) {
  if (change_pct == null) return '—'
  const sign = change_pct >= 0 ? '+' : ''
  return `${sign}${change_pct.toFixed(2)}%`
}

function formatPrice(close) {
  if (close == null) return '—'
  if (Math.abs(close) >= 1000) return close.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return close.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function changeClass(change_pct) {
  if (change_pct == null || change_pct === 0) return styles.neutral
  return change_pct > 0 ? styles.gain : styles.loss
}

export default function FuturesStrip() {
  const { data, isLoading, isError, error } = useDashboardFutures()

  const cacheNote = data?.cache
    ? `${data.cache.status} cache · ${data.cache.age_seconds}s old`
    : 'Latest close'

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <p className={styles.label}>Signals</p>
          <h2 className={styles.title}>Futures &amp; signals</h2>
        </div>
        <span className={styles.meta}>{isLoading ? 'Loading…' : isError ? 'Unavailable' : cacheNote}</span>
      </div>
      <div className={styles.strip}>
        {isLoading && <span className={styles.loading}>Loading…</span>}
        {isError && <span className={styles.error}>{error.message}</span>}
        {data?.items?.map((item) => (
          <div key={item.symbol} className={styles.tile}>
            <div className={styles.tileName}>{item.name}</div>
            <div className={styles.tileSymbol}>{item.symbol}</div>
            <div className={styles.tilePrice}>{formatPrice(item.close)}</div>
            <div className={`${styles.tileChange} ${changeClass(item.change_pct)}`}>
              {formatChange(item.change_pct)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FuturesStrip/
git commit -m "feat: add FuturesStrip component"
```

---

## Task 7: MarketCard component

**Files:**
- Create: `frontend/src/components/MarketCard/MarketCard.jsx`
- Create: `frontend/src/components/MarketCard/MarketCard.module.css`

The `useMarkets(sub)` hook returns data with shape `{ data: { columns: string[], rows: object[] } }`. Rows are objects keyed by column name (e.g., `row["Symbol"]`, `row["Change %"]`). Column names are found case-insensitively.

- [ ] **Step 1: Create `frontend/src/components/MarketCard/MarketCard.module.css`**

```css
.card {
  background: linear-gradient(145deg, var(--color-surface), var(--color-surface-2));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card:hover {
  border-color: var(--color-border-hover);
  background: linear-gradient(145deg, var(--color-surface-2), var(--color-surface));
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.headerLeft {}

.label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}

.title {
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.openBtn {
  font-size: 0.75rem;
  color: var(--accent-violet);
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  transition: background 0.15s, border-color 0.15s;
}

.openBtn:hover {
  background: var(--accent-indigo-dim);
  border-color: var(--color-border-hover);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 0;
  border-bottom: 1px solid rgba(99, 102, 241, 0.06);
}

.row:last-child {
  border-bottom: none;
}

.rowSymbol {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-mono);
  min-width: 60px;
}

.rowName {
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex: 1;
  padding: 0 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowChange {
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: var(--font-mono);
  text-align: right;
}

.gain { color: var(--color-gain); }
.loss { color: var(--color-loss); }
.volume { color: var(--color-volume); }
.neutral { color: var(--text-secondary); }

.loading {
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding: 0.5rem 0;
}

.error {
  font-size: 0.8125rem;
  color: var(--color-loss);
  padding: 0.5rem 0;
}

.empty {
  font-size: 0.8125rem;
  color: var(--text-muted);
  padding: 0.5rem 0;
}

.askBtn {
  align-self: flex-end;
  font-size: 0.75rem;
  color: var(--accent-violet);
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}

.askBtn:hover {
  opacity: 1;
  background: var(--accent-indigo-dim);
}
```

- [ ] **Step 2: Create `frontend/src/components/MarketCard/MarketCard.jsx`**

```jsx
import { useMarkets } from '../../hooks/useMarkets'
import styles from './MarketCard.module.css'

const CARD_META = {
  gainers:        { label: 'Top 5', title: 'Gainers' },
  losers:         { label: 'Top 5', title: 'Losers' },
  unusual_volume: { label: 'Top 5', title: 'Unusual Volume' },
}

function findCol(columns, test) {
  return columns.find((c) => test(c.toLowerCase())) ?? null
}

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

function changeColorClass(value, sub) {
  if (sub === 'unusual_volume') return styles.volume
  const n = parseSignedNumber(value)
  if (n == null || n === 0) return styles.neutral
  return n > 0 ? styles.gain : styles.loss
}

export default function MarketCard({ sub, onOpen, onAsk = () => {} }) {
  const { data, isLoading, isError, error } = useMarkets(sub)
  const meta = CARD_META[sub] ?? { label: '', title: sub }

  const columns = data?.data?.columns ?? []
  const rows = (data?.data?.rows ?? []).slice(0, 5)
  const symbolCol = findCol(columns, (c) => c === 'symbol')
  const nameCol   = findCol(columns, (c) => c === 'name')
  const changeCol = findCol(columns, (c) => c === 'change %') ??
                    findCol(columns, (c) => c.startsWith('change'))

  function handleCardClick(e) {
    if (e.target.closest('[data-ask]')) return
    onOpen(sub)
  }

  return (
    <div className={styles.card} onClick={handleCardClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(sub)}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <p className={styles.label}>{meta.label}</p>
          <h2 className={styles.title}>{meta.title}</h2>
        </div>
        <span className={styles.openBtn}>Open →</span>
      </div>

      <div className={styles.rows}>
        {isLoading && <span className={styles.loading}>Loading…</span>}
        {isError && <span className={styles.error}>{error.message}</span>}
        {!isLoading && !isError && rows.length === 0 && (
          <span className={styles.empty}>No data returned.</span>
        )}
        {rows.map((row, i) => {
          const symbol = symbolCol ? cleanSymbol(row[symbolCol]) : '—'
          const name   = nameCol ? String(row[nameCol] ?? '').trim() : ''
          const change = changeCol ? row[changeCol] : null
          const changeStr = change == null ? '—' : String(change)
          return (
            <div key={i} className={styles.row}>
              <span className={styles.rowSymbol}>{symbol}</span>
              <span className={styles.rowName}>{name || symbol}</span>
              <span className={`${styles.rowChange} ${changeColorClass(change, sub)}`}>
                {changeStr}
              </span>
            </div>
          )
        })}
      </div>

      <button data-ask className={styles.askBtn} onClick={(e) => { e.stopPropagation(); onAsk(sub) }}>
        ✦ Ask LLM
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MarketCard/
git commit -m "feat: add MarketCard component"
```

---

## Task 8: Dashboard page

**Files:**
- Create: `frontend/src/pages/Dashboard/Dashboard.jsx`
- Create: `frontend/src/pages/Dashboard/Dashboard.module.css`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Create `frontend/src/pages/Dashboard/Dashboard.module.css`**

```css
.page {}

.pageHead {
  margin-bottom: 2rem;
}

.eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent-violet);
  margin-bottom: 0.375rem;
}

.pageTitle {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2.5rem;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Create `frontend/src/pages/Dashboard/Dashboard.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import MarketCard from '../../components/MarketCard/MarketCard'
import IndexStrip from '../../components/IndexStrip/IndexStrip'
import FuturesStrip from '../../components/FuturesStrip/FuturesStrip'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const navigate = useNavigate()

  function handleOpen(sub) {
    navigate(`/markets?sub=${encodeURIComponent(sub)}`)
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <p className={styles.eyebrow}>Dashboard</p>
        <h1 className={styles.pageTitle}>Market pulse</h1>
      </div>

      <IndexStrip />
      <FuturesStrip />

      <div className={styles.grid}>
        <MarketCard sub="gainers" onOpen={handleOpen} />
        <MarketCard sub="losers" onOpen={handleOpen} />
        <MarketCard sub="unusual_volume" onOpen={handleOpen} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire Dashboard into `frontend/src/main.jsx`**

Replace the temporary Dashboard constant with the real import. Change the top of `main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import Dashboard from './pages/Dashboard/Dashboard'
import Chat from './pages/Chat/Chat'
import Dcf from './pages/Dcf/Dcf'
import Markets from './pages/Markets/Markets'
import Multi from './pages/Multi/Multi'
import NodeGraph from './pages/NodeGraph/NodeGraph'
import OptionScreener from './pages/OptionScreener/OptionScreener'
import PaperTrade from './pages/PaperTrade/PaperTrade'
import Screener from './pages/Screener/Screener'
import Ticker from './pages/Ticker/Ticker'
import Watchlist from './pages/Watchlist/Watchlist'
import './theme/tokens.css'
import './theme/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    },
  },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'markets', element: <Markets /> },
      { path: 'ticker/:symbol', element: <Ticker /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'screener', element: <Screener /> },
      { path: 'multi', element: <Multi /> },
      { path: 'option-screener', element: <OptionScreener /> },
      { path: 'dcf', element: <Dcf /> },
      { path: 'node-graph', element: <NodeGraph /> },
      { path: 'paper-trade', element: <PaperTrade /> },
      { path: 'chat', element: <Chat /> },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
```

- [ ] **Step 4: Verify the full dashboard in browser**

Open `http://localhost:5173/dashboard`. Check:
- Page header shows "Market pulse" with indigo eyebrow
- IndexStrip renders index tiles with names, symbols, and colored change %
- FuturesStrip renders futures tiles with prices and change %
- Three MarketCards (Gainers, Losers, Unusual Volume) show top 5 rows each
- Clicking a card navigates to `/markets?sub=gainers` etc. (stub page)
- Tiles scroll horizontally on narrow viewports

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/ frontend/src/main.jsx
git commit -m "feat: implement Dashboard page with IndexStrip, FuturesStrip, and MarketCards"
```

---

## Task 9: Production build and Python server verification

**Files:**
- Modify: `.gitignore` (if needed)

- [ ] **Step 1: Stop any running Vite dev server**

`Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 2: Run the production build**

```bash
cd frontend && npm run build
```

Expected output ends with lines like:
```
✓ built in Xs
dist/index.html   X kB
dist/assets/...
```

The files are written to `ui/static/`.

- [ ] **Step 3: Verify `ui/static/` was populated**

```bash
ls /mnt/machine_learning/Coding/python/WebInterface/StockLens/ui/static/
```

Expected: `index.html` plus an `assets/` directory containing JS and CSS chunks. The old `app.js`, `styles.css`, `marked.min.js` files will be gone — replaced by Vite's output.

- [ ] **Step 4: Start the Python server and verify**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/StockLens && uv run -m ui
```

Open `http://localhost:8765`. The StockLens React dashboard should load identically to the Vite dev server version. Verify:
- Nav renders
- Dashboard cards load data from `/api/*` endpoints via the Python server
- Navigating to `/markets` shows stub page

- [ ] **Step 5: Add `frontend/node_modules/` to `.gitignore` if not already present**

Check `.gitignore`:
```bash
grep "node_modules" /mnt/machine_learning/Coding/python/WebInterface/StockLens/.gitignore
```

If not present, add it:
```bash
echo "frontend/node_modules/" >> /mnt/machine_learning/Coding/python/WebInterface/StockLens/.gitignore
```

Also ensure `ui/static/assets/` is not accidentally ignored. The Vite build output in `ui/static/` should be committed (or left untracked per project preference — confirm with user).

- [ ] **Step 6: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/StockLens
git add .gitignore
git commit -m "chore: add frontend/node_modules to .gitignore"
```
