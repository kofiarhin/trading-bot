import { useDecisions } from "../hooks/queries/useDashboard.js";
import DecisionListMobile from "./DecisionListMobile.jsx";

function fmt(n, d = 4) {
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

function getWatchLevel(distance) {
  if (distance === null || distance === undefined) return "none";
  if (distance <= 0.25) return "very-close";
  if (distance <= 0.75) return "watch";
  return "far";
}

function DecisionBadge({ decision }) {
  const approved = decision === "Approved";
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        approved ? "bg-emerald-900 text-emerald-300" : "bg-red-900/60 text-red-300"
      }`}
    >
      {decision}
    </span>
  );
}

const DASHBOARD_PREVIEW_PARAMS = { limit: 10 };

export default function RecentDecisionsTable({ variant = "desktop", previewCount = 4 }) {
  const { data, isLoading } = useDecisions(DASHBOARD_PREVIEW_PARAMS);
  const decisions = data?.items ?? [];
  const summary = data?.summary;

  if (variant === "mobile") {
    return (
      <div className="border-0 rounded-none overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Recent Decisions</h2>
          {decisions.length > 0 && (
            <span className="text-xs text-slate-400">{decisions.length}</span>
          )}
        </div>
        {isLoading ? (
          <p className="px-4 py-3 text-slate-500 text-sm">Loading...</p>
        ) : (
          <DecisionListMobile decisions={decisions} previewCount={previewCount} />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Recent Decisions</h2>
        {summary && (summary.approved > 0 || summary.rejected > 0) && (
          <span className="text-xs text-slate-400">
            {summary.approved} approved / {summary.rejected} rejected
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="p-5 text-slate-500 text-sm">Loading...</p>
      ) : decisions.length === 0 ? (
        <p className="p-5 text-slate-500 text-sm">No decisions recorded today.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-700">
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Decision</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-right">Close</th>
                <th className="px-4 py-3 text-right">Breakout Level</th>
                <th className="px-4 py-3 text-right">ATR</th>
                <th className="px-4 py-3 text-right">Vol Ratio</th>
                <th className="px-4 py-3 text-right">Distance</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs whitespace-nowrap">{fmtTime(d.timestamp)}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-white">{d.symbol}</td>
                  <td className="px-4 py-3 text-slate-400">{d.assetClass ?? "—"}</td>
                  <td className="px-4 py-3">
                    <DecisionBadge decision={d.decision} />
                  </td>
                  <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={d.reason}>
                    {d.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">
                    {d.closePrice != null ? `$${fmt(d.closePrice, 2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {d.breakoutLevel != null ? `$${fmt(d.breakoutLevel, 2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(d.atr, 4)}</td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      d.volumeRatio != null && d.volumeRatio >= 1 ? "text-emerald-400" : "text-slate-400"
                    }`}
                  >
                    {d.volumeRatio != null ? `${fmt(d.volumeRatio, 2)}x` : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      getWatchLevel(d.distanceToBreakoutPct) === "very-close"
                        ? "text-yellow-300 font-bold"
                        : getWatchLevel(d.distanceToBreakoutPct) === "watch"
                        ? "text-yellow-500"
                        : "text-slate-400"
                    }`}
                  >
                    {d.distanceToBreakoutPct != null ? (
                      <>
                        {typeof d.distanceToBreakoutPct === "number" && Number.isFinite(d.distanceToBreakoutPct)
                          ? d.distanceToBreakoutPct.toFixed(2)
                          : "—"}
                        %
                        {getWatchLevel(d.distanceToBreakoutPct) === "very-close" && (
                          <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-400 text-black rounded">
                            VERY CLOSE
                          </span>
                        )}
                        {getWatchLevel(d.distanceToBreakoutPct) === "watch" && (
                          <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-600 text-white rounded">WATCH</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
