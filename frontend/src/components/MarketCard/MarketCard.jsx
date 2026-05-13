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
