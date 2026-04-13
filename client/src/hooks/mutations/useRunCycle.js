import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cycleService } from '../../services/cycle.js';

export function useRunCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cycleService.manualRunCycle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle', 'runtime'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'activity'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'decisions'] });
    },
  });
}
