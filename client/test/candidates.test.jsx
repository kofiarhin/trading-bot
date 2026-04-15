import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../src/hooks/queries/useAnalytics.js", () => ({
  useCandidates: vi.fn(),
}));

import { useCandidates } from "../src/hooks/queries/useAnalytics.js";
import CandidateList from "../src/components/CandidateList.jsx";
import ConversionFunnel from "../src/components/ConversionFunnel.jsx";

const payload = {
  cycleId: "cycle-xyz",
  totals: {
    scanned: 10,
    prefilterRejected: 3,
    scored: 7,
    shortlisted: 3,
    rankedOut: 2,
    strategyRejected: 1,
    riskBlocked: 1,
    approved: 2,
    placed: 1,
  },
  shortlisted: [{ symbol: "AAPL", rank: 1, score: 88, setupGrade: "A", shortlisted: true, stage: "strategy", approved: true }],
  rankedOut: [{ symbol: "MSFT", rank: 4, score: 61, rankedOut: true, rejectStage: "ranked_out", reason: "ranked_out" }],
  strategyRejected: [{ symbol: "NVDA", rank: 2, score: 70, shortlisted: true, rejectStage: "strategy", reason: "weak_risk_reward" }],
  riskBlocked: [],
  approved: [],
  placed: [],
  otherStageDecisions: [],
};

describe("candidate pipeline UI contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders shortlisted/rankedOut/stage metadata in candidate list", () => {
    render(<CandidateList data={payload} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getAllByText("shortlisted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ranked out").length).toBeGreaterThan(0);
  });

  it("renders conversion funnel from backend totals", () => {
    useCandidates.mockReturnValue({ data: payload, isLoading: false, isError: false });
    render(<ConversionFunnel cycleId="cycle-xyz" />);

    expect(screen.getByText("Scanned")).toBeInTheDocument();
    expect(screen.getByText("Scored")).toBeInTheDocument();
    expect(screen.getByText("Shortlisted")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Placed")).toBeInTheDocument();
    expect(screen.getByText(/Cycle: cycle-xyz/)).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
