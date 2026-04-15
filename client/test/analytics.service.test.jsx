import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/api.js", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "../src/lib/api.js";
import { analyticsService } from "../src/services/analytics.js";

describe("analyticsService.getCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes structured candidates payload", async () => {
    api.get.mockResolvedValue({ data: { cycleId: "abc", totals: { scanned: 2 }, shortlisted: [] } });
    const result = await analyticsService.getCandidates("abc");
    expect(result.cycleId).toBe("abc");
    expect(result.totals.scanned).toBe(2);
    expect(result.totals.rankedOut).toBe(0);
  });

  it("keeps backward compatibility with legacy array responses", async () => {
    api.get.mockResolvedValue({ data: [{ symbol: "AAPL", approved: true }] });
    const result = await analyticsService.getCandidates("legacy");
    expect(result.shortlisted).toHaveLength(1);
    expect(result.approved).toHaveLength(1);
    expect(result.totals.scanned).toBe(0);
  });
});
