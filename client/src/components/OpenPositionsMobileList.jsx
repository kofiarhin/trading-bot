import { useState } from "react";
import { useOpenPositions } from "../hooks/queries/useDashboard.js";

function fmt(n, d = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function Stat({ label, value, valueClass = "text-slate-200" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xs font-mono truncate ${valueClass}`}>{value}</p>
    </div>
  );
}

function ManagementBadges({ origin, managementStatus, orphaned }) {
  if (orphaned) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-medium">
        Orphaned
      </span>
    );
  }
  if (origin !== "broker_sync") return null;

  return (
    <div className="flex flex-wrap gap-1">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 font-medium">
        Broker Sync
      </span>
      {managementStatus === "derived" && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium">
          Derived
        </span>
      )}
      {managementStatus === "unmanaged" && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-medium animate-pulse">
          Unmanaged
        </span>
      )}
    </div>
  );
}

export default function OpenPositionsMobileList({ previewCount = 3 }) {
  const { data: positions = [], isLoading } = useOpenPositions();
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Open Positions</h2>
        </div>
        <p className="px-4 py-3 text-slate-500 text-sm">Loading...</p>
      </div>
    );
  }

  const visible = showAll ? positions : positions.slice(0, previewCount);

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden md:hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Open Positions</h2>
        <span className="text-xs text-slate-400">{positions.length}</span>
      </div>

      {positions.length === 0 ? (
        <p className="px-4 py-3 text-slate-500 text-sm">No open positions.</p>
      ) : (
        <div className="divide-y divide-slate-700/50">
          {visible.map((p, i) => {
            const pnlColor = p.unrealizedPnl > 0 ? "text-emerald-400" : p.unrealizedPnl < 0 ? "text-red-400" : "text-slate-200";
            const isUnmanaged = p.managementStatus === "unmanaged";
            const articleClass = isUnmanaged
              ? "px-4 py-3 space-y-2.5 bg-red-900/10"
              : "px-4 py-3 space-y-2.5";

            return (
              <article key={i} className={articleClass}>
                <div className="flex items-start gap-2 flex-wrap">
                  <p className="font-mono font-semibold text-white text-sm truncate">{p.symbol}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 uppercase">
                    {p.assetClass ?? "—"}
                  </span>
                  <ManagementBadges
                    origin={p.origin}
                    managementStatus={p.managementStatus}
                    orphaned={p.orphaned}
                  />
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Qty" value={fmt(p.quantity, 4)} />
                  <Stat label="Entry" value={p.entryPrice != null ? `$${fmt(p.entryPrice)}` : "—"} />
                  <Stat label="Current" value={p.currentPrice != null ? `$${fmt(p.currentPrice)}` : "—"} />
                  <Stat
                    label="PnL"
                    value={p.unrealizedPnl != null ? `${p.unrealizedPnl > 0 ? "+" : ""}$${fmt(p.unrealizedPnl)}` : "—"}
                    valueClass={p.unrealizedPnl != null ? pnlColor : "text-slate-200"}
                  />
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Stat label="Stop" value={p.stopLoss != null ? `$${fmt(p.stopLoss)}` : "—"} valueClass="text-red-400" />
                  <Stat label="Target" value={p.takeProfit != null ? `$${fmt(p.takeProfit)}` : "—"} valueClass="text-emerald-400" />
                  <Stat label="Risk" value={p.riskAmount != null ? `$${fmt(p.riskAmount)}` : "—"} />
                  <Stat label="Opened" value={fmtTime(p.openedAt)} />
                </div>
              </article>
            );
          })}

          {positions.length > previewCount && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="w-full px-4 py-2.5 text-xs font-medium text-sky-300 hover:text-sky-200 bg-slate-900/40"
            >
              {showAll ? "Show Less" : `View All (${positions.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
