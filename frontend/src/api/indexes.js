export async function fetchDashboardIndexes() {
  const res = await fetch('/api/dashboard-indexes')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}
