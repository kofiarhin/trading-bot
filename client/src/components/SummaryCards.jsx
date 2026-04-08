import { useSummary, useStatus } from "../hooks/queries/useDashboard.js";

function Card({ label, value, sub, highlight }) {
  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${highlight ?? "text-white"}`}>{value ?? "—"}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

function fmt(n, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtUsd(n) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${fmt(Math.abs(n))}`;
}

export default function SummaryCards() {
  const { data: summary } = useSummary();
  const { data: status } = useStatus();

  const botStatus = status?.botStatus ?? summary?.botStatus ?? "idle";
  const isActive = botStatus === "active";

  const pnl = summary?.dailyPnl ?? 0;
  const pnlColor = pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : "text-white";

  const lastCycle = summary?.lastCycleTime
    ? new Date(summary.lastCycleTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      <Card
        label="Bot Status"
        value={
          <span className="flex items-center gap-2 text-lg">
            <span className={`w-2.5 h-2.5 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {isActive ? "Active" : "Idle"}
          </span>
        }
        sub={status?.runMode === "paper" ? "Paper trading" : status?.runMode}
      />
      <Card
        label="Last Cycle"
        value={lastCycle ?? "—"}
        sub="ET"
      />
      <Card label="Symbols Scanned" value={summary?.symbolsScanned ?? "—"} />
      <Card label="Approved Signals" value={summary?.approvedSignals ?? "—"} />
      <Card label="Orders Today" value={summary?.ordersPlacedToday ?? "—"} />
      <Card label="Open Positions" value={summary?.openPositionsCount ?? "—"} />
      <Card
        label="Daily PnL"
        value={fmtUsd(pnl)}
        highlight={pnlColor}
        sub={summary?.equity != null ? `Equity $${fmt(summary.equity, 0)}` : null}
      />
    </div>
  );
}
