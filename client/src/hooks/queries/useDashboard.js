import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "../../services/dashboard.js";

export function useStatus() {
  return useQuery({
    queryKey: ["dashboard", "status"],
    queryFn: dashboardService.getStatus,
    refetchInterval: 15_000,
  });
}

export function useSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardService.getSummary,
    refetchInterval: 15_000,
  });
}

export function useLatestCycle() {
  return useQuery({
    queryKey: ["dashboard", "cycles", "latest"],
    queryFn: dashboardService.getLatestCycle,
    refetchInterval: 15_000,
  });
}

export function useSignals() {
  return useQuery({
    queryKey: ["dashboard", "signals"],
    queryFn: dashboardService.getSignals,
    refetchInterval: 30_000,
  });
}

export function useOpenPositions() {
  return useQuery({
    queryKey: ["dashboard", "positions", "open"],
    queryFn: dashboardService.getOpenPositions,
    refetchInterval: 15_000,
  });
}

export function useDecisions(params = {}) {
  return useQuery({
    queryKey: ["dashboard", "decisions", params],
    queryFn: () => dashboardService.getDecisions(params),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useActivity(params = {}) {
  return useQuery({
    queryKey: ["dashboard", "activity", params],
    queryFn: () => dashboardService.getActivity(params),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
}
