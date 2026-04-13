import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePagination({ page = 1, limit = 25, total = 0, pages = 0 } = {}) {
  return {
    page,
    limit,
    total,
    pages,
    hasPrevPage: page > 1,
    hasNextPage: page < pages,
  };
}

function makeDecisionResponse({ items = [], page = 1, limit = 25, total = 0, pages = 0 } = {}) {
  return {
    items,
    pagination: makePagination({ page, limit, total, pages }),
    filters: {},
    summary: {
      approved: items.filter((d) => d.decision === "Approved").length,
      rejected: items.filter((d) => d.decision === "Rejected").length,
    },
  };
}

function makeActivityResponse({ items = [], page = 1, limit = 25, total = 0, pages = 0 } = {}) {
  return {
    items,
    pagination: makePagination({ page, limit, total, pages }),
    filters: {},
  };
}

function makeDecisionItem(symbol = "AAPL", decision = "Approved") {
  return {
    timestamp: "2026-04-13T10:00:00.000Z",
    symbol,
    assetClass: "Stock",
    decision,
    reason: decision === "Approved" ? "breakout confirmed" : "volume too low",
    closePrice: 180,
    breakoutLevel: 178,
    atr: 1.5,
    volumeRatio: 1.2,
    distanceToBreakoutPct: 0.5,
  };
}

function makeActivityItem(type = "cycle_complete", label = "Cycle complete") {
  return { type, label, timestamp: "2026-04-13T10:00:00.000Z" };
}

// ─── Mock hooks ───────────────────────────────────────────────────────────────

vi.mock("../src/hooks/queries/useDashboard.js", () => ({
  useDecisions: vi.fn(),
  useActivity: vi.fn(),
}));

import { useDecisions, useActivity } from "../src/hooks/queries/useDashboard.js";

function wrapper(initialUrl = "/history") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Lazy import to avoid circular reference — import HistoryPage inline
  const { default: HistoryPage } = await vi.importActual("../src/pages/HistoryPage.jsx");
  return ({ children }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function renderHistoryPage(url = "/history") {
  const { default: HistoryPage } = await import("../src/pages/HistoryPage.jsx");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HistoryPage — Decision History section", () => {
  it("renders loading state initially", async () => {
    useDecisions.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getAllByText("Loading…")).toHaveLength(1);
  });

  it("renders empty state when no decisions", async () => {
    useDecisions.mockReturnValue({ data: makeDecisionResponse(), isLoading: false, isError: false });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText("No decisions match the current filters.")).toBeInTheDocument();
  });

  it("renders decision rows", async () => {
    const items = [makeDecisionItem("AAPL", "Approved"), makeDecisionItem("BTCUSD", "Rejected")];
    useDecisions.mockReturnValue({
      data: makeDecisionResponse({ items, total: 2, pages: 1 }),
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("BTCUSD")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("shows total count in section header", async () => {
    const items = [makeDecisionItem("AAPL")];
    useDecisions.mockReturnValue({
      data: makeDecisionResponse({ items, total: 42, pages: 2 }),
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText("42 total")).toBeInTheDocument();
  });

  it("shows summary approved/rejected counts", async () => {
    const items = [makeDecisionItem("AAPL", "Approved"), makeDecisionItem("MSFT", "Approved")];
    useDecisions.mockReturnValue({
      data: { ...makeDecisionResponse({ items, total: 2, pages: 1 }), summary: { approved: 2, rejected: 0 } },
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText(/2 approved/)).toBeInTheDocument();
    expect(screen.getByText(/0 rejected/)).toBeInTheDocument();
  });

  it("renders pagination controls", async () => {
    const items = Array.from({ length: 3 }, (_, i) => makeDecisionItem(`SYM${i}`));
    useDecisions.mockReturnValue({
      data: makeDecisionResponse({ items, total: 50, pages: 2, page: 1 }),
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText(/1–3 of 50/)).toBeInTheDocument();
    expect(screen.getByText("‹ Prev")).toBeDisabled();
    expect(screen.getByText("Next ›")).not.toBeDisabled();
  });

  it("Prev button is disabled on first page", async () => {
    useDecisions.mockReturnValue({
      data: makeDecisionResponse({ items: [makeDecisionItem()], total: 10, pages: 2, page: 1 }),
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText("‹ Prev")).toBeDisabled();
  });

  it("Next button is disabled on last page", async () => {
    useDecisions.mockReturnValue({
      data: makeDecisionResponse({ items: [makeDecisionItem()], total: 10, pages: 2, page: 2, hasPrevPage: true, hasNextPage: false }),
      isLoading: false,
      isError: false,
    });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage("/history?d_page=2");

    const nextButtons = screen.getAllByText("Next ›");
    expect(nextButtons[0]).toBeDisabled();
  });
});

describe("HistoryPage — Activity History section", () => {
  it("renders loading state for activity", async () => {
    useDecisions.mockReturnValue({ data: makeDecisionResponse(), isLoading: false, isError: false });
    useActivity.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    await renderHistoryPage();

    expect(screen.getAllByText("Loading…")).toHaveLength(1);
  });

  it("renders empty state when no activity", async () => {
    useDecisions.mockReturnValue({ data: makeDecisionResponse(), isLoading: false, isError: false });
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    await renderHistoryPage();

    expect(screen.getByText("No activity matches the current filters.")).toBeInTheDocument();
  });

  it("renders activity items", async () => {
    const items = [
      makeActivityItem("cycle_complete", "Cycle complete — scanned 20"),
      makeActivityItem("approved", "Strategy approved — AAPL"),
    ];
    useDecisions.mockReturnValue({ data: makeDecisionResponse(), isLoading: false, isError: false });
    useActivity.mockReturnValue({
      data: makeActivityResponse({ items, total: 2, pages: 1 }),
      isLoading: false,
      isError: false,
    });

    await renderHistoryPage();

    expect(screen.getByText("Cycle complete — scanned 20")).toBeInTheDocument();
    expect(screen.getByText("Strategy approved — AAPL")).toBeInTheDocument();
  });
});

describe("RecentDecisionsTable — dashboard preview uses limit=10", () => {
  it("passes limit=10 to useDecisions", async () => {
    useDecisions.mockReturnValue({ data: makeDecisionResponse(), isLoading: false, isError: false });

    const { default: RecentDecisionsTable } = await import("../src/components/RecentDecisionsTable.jsx");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <RecentDecisionsTable />
      </QueryClientProvider>
    );

    expect(useDecisions).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });
});

describe("ActivityFeed — dashboard preview uses limit=10", () => {
  it("passes limit=10 to useActivity", async () => {
    useActivity.mockReturnValue({ data: makeActivityResponse(), isLoading: false, isError: false });

    const { default: ActivityFeed } = await import("../src/components/ActivityFeed.jsx");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <ActivityFeed />
      </QueryClientProvider>
    );

    expect(useActivity).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });
});
