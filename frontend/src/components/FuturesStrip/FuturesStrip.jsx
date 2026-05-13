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
