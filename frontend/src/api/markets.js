export async function fetchMarkets(sub) {
  const res = await fetch(`/api/markets?sub=${encodeURIComponent(sub)}`)
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}
