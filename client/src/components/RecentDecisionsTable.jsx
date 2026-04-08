import { useDecisions } from "../hooks/queries/useDashboard.js";

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

export default function RecentDecisionsTable() {
  const { data: decisions = [], isLoading } = useDecisions();

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Recent Decisions
        </h2>
        {decisions.length > 0 && (
          <span className="text-xs text-slate-400">
            {decisions.filter((d) => d.decision === "Approved").length} approved /{" "}
            {decisions.filter((d) => d.decision === "Rejected").length} rejected
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
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs whitespace-nowrap">
                    {fmtTime(d.timestamp)}
                  </td>
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
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {fmt(d.atr, 4)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      d.volumeRatio != null && d.volumeRatio >= 1
                        ? "text-emerald-400"
                        : "text-slate-400"
                    }`}
                  >
                    {d.volumeRatio != null ? `${fmt(d.volumeRatio, 2)}x` : "—"}
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
