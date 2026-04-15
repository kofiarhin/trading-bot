import { api } from "../lib/api.js";

function emptyCandidatesPayload(cycleId = null) {
  return {
    cycleId,
    totals: {
      scanned: 0,
      prefilterRejected: 0,
      scored: 0,
      shortlisted: 0,
      rankedOut: 0,
      strategyRejected: 0,
      riskBlocked: 0,
      approved: 0,
      placed: 0,
    },
    shortlisted: [],
    rankedOut: [],
    strategyRejected: [],
    riskBlocked: [],
    approved: [],
    placed: [],
    otherStageDecisions: [],
  };
}

function normalizeCandidatesResponse(payload, cycleId) {
  if (Array.isArray(payload)) {
    // Backward compatibility for older servers
    return {
      ...emptyCandidatesPayload(cycleId ?? null),
      shortlisted: payload,
      approved: payload.filter((c) => c.approved),
    };
  }
  return {
    ...emptyCandidatesPayload(cycleId ?? payload?.cycleId ?? null),
    ...(payload ?? {}),
    totals: {
      ...emptyCandidatesPayload().totals,
      ...(payload?.totals ?? {}),
    },
  };
}

export const analyticsService = {
  getPerformance: (days = 30) =>
    api.get("/performance", { params: { days } }).then((r) => r.data),

  getExposure: () =>
    api.get("/exposure").then((r) => r.data),

  getExpectancy: (days = 30) =>
    api.get("/expectancy", { params: { days } }).then((r) => r.data),

  getCandidates: (cycleId) =>
    api
      .get("/candidates", { params: cycleId ? { cycleId } : {} })
      .then((r) => normalizeCandidatesResponse(r.data, cycleId)),

  getRejections: (days = 7) =>
    api.get("/rejections", { params: { days } }).then((r) => r.data),

  getConversionStats: (days = 7) =>
    api.get("/analytics/conversion", { params: { days } }).then((r) => r.data),

  getScoreDistribution: (days = 7) =>
    api.get("/analytics/scores", { params: { days } }).then((r) => r.data),
};
