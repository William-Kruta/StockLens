import { useQuery } from '@tanstack/react-query'
import { fetchDashboardIndexes } from '../api/indexes'

export function useDashboardIndexes() {
  return useQuery({
    queryKey: ['dashboard-indexes'],
    queryFn: fetchDashboardIndexes,
    refetchInterval: 60_000,
  })
}
