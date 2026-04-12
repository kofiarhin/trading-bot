import { useQuery } from "@tanstack/react-query";
import { journalService } from "../../services/journal.js";

export function useJournalSummary() {
  return useQuery({
    queryKey: ["journal", "summary"],
    queryFn: journalService.getSummary,
    refetchInterval: 30_000,
  });
}

export function useJournalTrades(filters = {}) {
  return useQuery({
    queryKey: ["journal", "trades", filters],
    queryFn: () => journalService.getTrades(filters),
    refetchInterval: 30_000,
    keepPreviousData: true,
  });
}

export function useTradeDetail(tradeId) {
  return useQuery({
    queryKey: ["journal", "trade", tradeId],
    queryFn: () => journalService.getTradeById(tradeId),
    enabled: Boolean(tradeId),
  });
}
