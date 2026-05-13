import { useParams } from 'react-router-dom'
export default function Ticker() {
  const { symbol } = useParams()
  return <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>{symbol} — coming soon.</div>
}
