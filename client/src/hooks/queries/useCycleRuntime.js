import { useQuery } from '@tanstack/react-query';
import { cycleService } from '../../services/cycle.js';

export function useCycleRuntime() {
  return useQuery({
    queryKey: ['cycle', 'runtime'],
    queryFn: cycleService.getRuntime,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2_000 : 10_000),
    staleTime: 2_000,
    placeholderData: (prev) => prev,
  });
}
