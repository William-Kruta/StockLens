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
