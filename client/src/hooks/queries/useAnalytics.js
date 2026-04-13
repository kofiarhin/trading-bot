import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "../../services/analytics.js";

export function usePerformance(days = 30) {
  return useQuery({
    queryKey: ["performance", days],
    queryFn: () => analyticsService.getPerformance(days),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useExposure() {
  return useQuery({
    queryKey: ["exposure"],
    queryFn: () => analyticsService.getExposure(),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}

export function useCandidates(cycleId) {
  return useQuery({
    queryKey: ["candidates", cycleId ?? "latest"],
    queryFn: () => analyticsService.getCandidates(cycleId),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useRejections(days = 7) {
  return useQuery({
    queryKey: ["rejections", days],
    queryFn: () => analyticsService.getRejections(days),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
