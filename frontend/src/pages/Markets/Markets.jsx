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
