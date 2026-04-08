import SummaryCards from "../components/SummaryCards.jsx";
import LastCyclePanel from "../components/LastCyclePanel.jsx";
import SignalsTable from "../components/SignalsTable.jsx";
import OpenPositionsTable from "../components/OpenPositionsTable.jsx";
import ActivityFeed from "../components/ActivityFeed.jsx";
import { useStatus } from "../hooks/queries/useDashboard.js";

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
    <main className="min-h-screen bg-slate-950 text-white px-4 py-6 md:px-8">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        <Header />
        <SummaryCards />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <LastCyclePanel />
          </div>
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
        </div>

        <SignalsTable />
        <OpenPositionsTable />
      </div>
    </main>
  );
}
