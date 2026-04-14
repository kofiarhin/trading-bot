import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "../../services/analytics.js";

export function useCandidatesForCycle(cycleId) {
  return useQuery({
    queryKey: ["candidates", cycleId ?? "latest"],
    queryFn: () => analyticsService.getCandidates(cycleId),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
