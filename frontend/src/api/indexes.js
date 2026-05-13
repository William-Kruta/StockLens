export async function fetchDashboardIndexes() {
  const res = await fetch('/api/dashboard-indexes')
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
