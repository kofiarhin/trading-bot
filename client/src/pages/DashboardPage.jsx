import { useState, useEffect } from "react";
import SummaryCards from "../components/SummaryCards.jsx";
import LastCyclePanel from "../components/LastCyclePanel.jsx";
import RecentDecisionsTable from "../components/RecentDecisionsTable.jsx";
import OpenPositionsTable from "../components/OpenPositionsTable.jsx";
import ActivityFeed from "../components/ActivityFeed.jsx";
import { useStatus } from "../hooks/queries/useDashboard.js";

const REFRESH_INTERVAL_S = 15;

function useRefreshTimestamp() {
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setLastUpdated(new Date()), REFRESH_INTERVAL_S * 1000);
    return () => clearInterval(id);
  }, []);

  return lastUpdated;
}

function fmtTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function AutoRefreshIndicator() {
  const lastUpdated = useRefreshTimestamp();
  return (
    <div className="text-xs text-slate-500 text-right leading-relaxed">
      <span>Last updated: {fmtTime(lastUpdated)}</span>
      <span className="ml-3 text-slate-600">Refresh: every {REFRESH_INTERVAL_S}s</span>
    </div>
  );
}

function Header() {
  const { data: status } = useStatus();
  const isActive = status?.botStatus === "active";

  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Trading Bot</h1>
        <p className="text-xs text-slate-500 mt-0.5">Dashboard — live view</p>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
        <span className={isActive ? "text-emerald-400" : "text-slate-400"}>
          {isActive ? "Bot running" : "Bot idle"}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <main className="px-4 py-6 md:px-8">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        <Header />

        {/* Row 1: Summary cards */}
        <SummaryCards />

        {/* Row 2: Last Cycle + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <LastCyclePanel />
          </div>
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
        </div>

        {/* Row 3: Recent Decisions (full width) */}
        <RecentDecisionsTable />

        {/* Row 4: Open Positions (full width) */}
        <OpenPositionsTable />

        {/* Auto refresh indicator */}
        <AutoRefreshIndicator />
      </div>
    </main>
  );
}
