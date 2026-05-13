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
import Dashboard from './pages/Dashboard/Dashboard'
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
