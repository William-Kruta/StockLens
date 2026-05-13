export async function fetchDashboardFutures() {
  const res = await fetch('/api/dashboard-futures')
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
