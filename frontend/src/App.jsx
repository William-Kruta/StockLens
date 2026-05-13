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
