import { api } from "../lib/api.js";

export const dashboardService = {
  getStatus: () => api.get("/dashboard/status").then((r) => r.data),
  getSummary: () => api.get("/dashboard/summary").then((r) => r.data),
  getLatestCycle: () => api.get("/dashboard/cycles/latest").then((r) => r.data),
  getDecisions: (params = {}) => api.get("/dashboard/decisions", { params }).then((r) => r.data),
  getSignals: () => api.get("/dashboard/signals").then((r) => r.data),
  getOpenPositions: () => api.get("/dashboard/positions/open").then((r) => r.data),
  getClosedPositions: () => api.get("/dashboard/positions/closed").then((r) => r.data),
  getPerformance: () => api.get("/dashboard/performance").then((r) => r.data),
  getActivity: (params = {}) => api.get("/dashboard/activity", { params }).then((r) => r.data),
};
