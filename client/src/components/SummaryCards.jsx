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

function PnlCard({ realized, unrealized, equity }) {
  const total = (realized ?? 0) + (unrealized ?? 0);
  const totalColor = total > 0 ? "text-emerald-400" : total < 0 ? "text-red-400" : "text-white";

  function fmtUsd(n) {
    if (n == null) return "—";
    const sign = n >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">PnL</span>
      <span className={`text-xl font-bold ${totalColor}`}>{fmtUsd(total)}</span>
      <div className="flex flex-col gap-0.5 mt-0.5">
        <span className="text-xs text-slate-500">
          Realized: <span className={realized >= 0 ? "text-emerald-400/80" : "text-red-400/80"}>{fmtUsd(realized)}</span>
        </span>
        <span className="text-xs text-slate-500">
          Unrealized: <span className={unrealized >= 0 ? "text-emerald-400/80" : "text-red-400/80"}>{fmtUsd(unrealized)}</span>
        </span>
        {equity != null && (
          <span className="text-xs text-slate-500">
            Equity: ${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusCard({ statusLabel, runMode, dryRun }) {
  const isRunning =
    statusLabel === "Running" ||
    statusLabel === "Paper Trading" ||
    statusLabel === "Dry Run" ||
    statusLabel === "Waiting for next cycle";

  const dotColor = isRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-500";
  const textColor = isRunning ? "text-emerald-400" : "text-slate-400";

  const subParts = [];
  if (runMode === "paper") subParts.push("Paper trading");
  if (dryRun) subParts.push("Dry run ON");

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">Bot Status</span>
      <span className={`text-lg font-bold flex items-center gap-2 ${textColor}`}>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
        {statusLabel ?? "Idle"}
      </span>
      {subParts.length > 0 && (
        <span className="text-xs text-slate-500">{subParts.join(" • ")}</span>
      )}
    </div>
  );
}

export default function SummaryCards() {
  const { data: summary } = useSummary();
  const { data: status } = useStatus();

  const lastCycle = summary?.lastCycleTime
    ? new Date(summary.lastCycleTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      <StatusCard
        statusLabel={status?.statusLabel ?? (status?.botStatus === "active" ? "Active" : "Idle")}
        runMode={status?.runMode}
        dryRun={status?.dryRun}
      />
      <Card label="Last Cycle" value={lastCycle ?? "—"} sub="ET" />
      <Card label="Symbols Scanned" value={summary?.symbolsScanned ?? "—"} />
      <Card label="Approved Signals" value={summary?.approvedSignals ?? "—"} />
      <Card label="Orders Today" value={summary?.ordersPlacedToday ?? "—"} />
      <Card label="Open Positions" value={summary?.openPositionsCount ?? "—"} />
      <PnlCard
        realized={summary?.realizedPnl ?? 0}
        unrealized={summary?.unrealizedPnl ?? 0}
        equity={summary?.equity}
      />
    </div>
  );
}
