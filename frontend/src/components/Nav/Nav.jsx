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
