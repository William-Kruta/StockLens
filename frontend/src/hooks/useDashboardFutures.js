import { useQuery } from '@tanstack/react-query'
import { fetchDashboardFutures } from '../api/futures'

export function useDashboardFutures() {
  return useQuery({
    queryKey: ['dashboard-futures'],
    queryFn: fetchDashboardFutures,
    refetchInterval: 60_000,
  })
}
