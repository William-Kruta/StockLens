export async function fetchMarkets(sub) {
  const res = await fetch(`/api/markets?sub=${encodeURIComponent(sub)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}
