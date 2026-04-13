import { useQuery } from '@tanstack/react-query';
import { cycleService } from '../../services/cycle.js';

export function useCycleRuntime() {
  return useQuery({
    queryKey: ['cycle', 'runtime'],
    queryFn: cycleService.getRuntime,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 5_000 : 15_000),
    staleTime: 10_000,
  });
}
