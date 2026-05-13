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
