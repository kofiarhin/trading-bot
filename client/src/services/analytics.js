import { api } from "../lib/api.js";

export const analyticsService = {
  getPerformance: (days = 30) =>
    api.get("/performance", { params: { days } }).then((r) => r.data),

  getExposure: () =>
    api.get("/exposure").then((r) => r.data),

  getExpectancy: (days = 30) =>
    api.get("/expectancy", { params: { days } }).then((r) => r.data),

  getCandidates: (cycleId) =>
    api.get("/candidates", { params: cycleId ? { cycleId } : {} }).then((r) => r.data),

  getRejections: (days = 7) =>
    api.get("/rejections", { params: { days } }).then((r) => r.data),
};
