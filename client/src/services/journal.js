import { api } from "../lib/api.js";

export const journalService = {
  getSummary: () => api.get("/journal/summary").then((r) => r.data),

  getTrades: (params = {}) =>
    api.get("/journal/trades", { params }).then((r) => r.data),

  getTradeById: (tradeId) =>
    api.get(`/trades/${tradeId}`).then((r) => r.data),
};
