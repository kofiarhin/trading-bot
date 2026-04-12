import { useState } from "react";

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
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function DecisionBadge({ decision }) {
  const approved = decision === "Approved";
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
        approved ? "bg-emerald-900 text-emerald-300" : "bg-red-900/60 text-red-300"
      }`}
    >
      {decision ?? "—"}
    </span>
  );
}

function RowLabel({ label, value, valueClass = "text-slate-200" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xs font-mono truncate ${valueClass}`}>{value}</p>
    </div>
  );
}

export default function DecisionListMobile({ decisions = [], previewCount = 4 }) {
  const [expanded, setExpanded] = useState(false);

  if (decisions.length === 0) {
    return <p className="px-4 py-3 text-slate-500 text-sm">No decisions recorded today.</p>;
  }

  const visibleDecisions = expanded ? decisions : decisions.slice(0, previewCount);
  const hasMore = decisions.length > previewCount;

  return (
    <div className="divide-y divide-slate-700/50">
      {visibleDecisions.map((d, i) => (
        <article key={i} className="px-4 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <p className="font-mono font-semibold text-white text-sm truncate">{d.symbol ?? "—"}</p>
            <DecisionBadge decision={d.decision} />
            <span className="ml-auto text-[11px] text-slate-500 font-mono shrink-0">{fmtTime(d.timestamp)}</span>
          </div>

          <p className="text-xs text-slate-300 truncate" title={d.reason ?? ""}>
            {d.reason ?? "—"}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <RowLabel
              label="Distance"
              value={
                d.distanceToBreakoutPct != null && Number.isFinite(d.distanceToBreakoutPct)
                  ? `${d.distanceToBreakoutPct.toFixed(2)}%`
                  : "—"
              }
              valueClass={
                d.distanceToBreakoutPct != null && d.distanceToBreakoutPct <= 0.75
                  ? "text-yellow-400"
                  : "text-slate-200"
              }
            />
            <RowLabel
              label="Vol Ratio"
              value={d.volumeRatio != null ? `${fmt(d.volumeRatio, 2)}x` : "—"}
              valueClass={d.volumeRatio != null && d.volumeRatio >= 1 ? "text-emerald-400" : "text-slate-200"}
            />
            <RowLabel
              label="Close"
              value={d.closePrice != null ? `$${fmt(d.closePrice, 2)}` : "—"}
            />
          </div>

          <details className="group">
            <summary className="cursor-pointer text-[11px] text-slate-400 group-open:text-slate-300">More details</summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <RowLabel label="Breakout" value={d.breakoutLevel != null ? `$${fmt(d.breakoutLevel, 2)}` : "—"} />
              <RowLabel label="ATR" value={d.atr != null ? fmt(d.atr, 4) : "—"} />
              <RowLabel label="Asset" value={d.assetClass ?? "—"} />
            </div>
          </details>
        </article>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full px-4 py-2.5 text-xs font-medium text-sky-300 hover:text-sky-200 bg-slate-900/40"
        >
          {expanded ? "Show Less" : `Show More (${decisions.length - previewCount})`}
        </button>
      )}
    </div>
  );
}
