export async function fetchDashboardFutures() {
  const res = await fetch('/api/dashboard-futures')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}
