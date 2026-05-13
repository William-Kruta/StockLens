import { useQuery } from '@tanstack/react-query'
import { fetchMarkets } from '../api/markets'

export function useMarkets(sub) {
  return useQuery({
    queryKey: ['markets', sub],
    queryFn: () => fetchMarkets(sub),
    refetchInterval: 60_000,
  })
}
