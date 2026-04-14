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

function PnlCell({ value }) {
  if (value == null) return <td className="px-4 py-3 text-right text-slate-400">—</td>;
  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-slate-400";
  const sign = value > 0 ? "+" : "";
  return (
    <td className={`px-4 py-3 text-right font-mono ${color}`}>
      {sign}${fmt(value)}
    </td>
  );
}

function OrphanedBadge() {
  return (
    <span
      title="No journal record found for this broker position. Strategy, stop, target and risk data are unavailable."
      className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-medium"
    >
      Orphaned
    </span>
  );
}

function BrokerSyncBadge() {
  return (
    <span
      title="Position detected via broker sync — not placed by this strategy cycle."
      className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 font-medium"
    >
      Broker Sync
    </span>
  );
}

function DerivedBadge() {
  return (
    <span
      title="Stop and target derived from ATR or fixed % — not sourced from a strategy signal."
      className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium"
    >
      Derived
    </span>
  );
}

function UnmanagedBadge() {
  return (
    <span
      title="No stop or target available for this position. Manual monitoring required."
      className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-medium animate-pulse"
    >
      Unmanaged
    </span>
  );
}

function ManagementBadge({ origin, managementStatus }) {
  if (origin === "broker_sync") {
    return (
      <>
        <BrokerSyncBadge />
        {managementStatus === "derived" && <DerivedBadge />}
        {managementStatus === "unmanaged" && <UnmanagedBadge />}
      </>
    );
  }
  return null;
}

export default function OpenPositionsTable() {
  const { data: positions = [], isLoading } = useOpenPositions();

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Open Positions
        </h2>
        {positions.length > 0 && (
          <span className="text-xs text-slate-400">
            {positions.length} position{positions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="p-5 text-slate-500 text-sm">Loading...</p>
      ) : positions.length === 0 ? (
        <p className="p-5 text-slate-500 text-sm">No open positions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-700">
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Strategy</th>
                <th className="px-4 py-3 text-left">Opened</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Entry</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Stop</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Risk $</th>
                <th className="px-4 py-3 text-right">Unrealized PnL</th>
                <th className="px-4 py-3 text-right">PnL %</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => {
                const pnlPct = p.unrealizedPnlPct;
                const pctColor =
                  pnlPct > 0 ? "text-emerald-400" : pnlPct < 0 ? "text-red-400" : "text-slate-400";
                const strategyLabel = p.strategyName
                  ? p.strategyName.replace(/_/g, " ")
                  : "—";
                const isUnmanaged = p.managementStatus === "unmanaged";
                const rowClass = p.orphaned
                  ? "border-b border-slate-700/50 bg-yellow-900/10 hover:bg-yellow-900/20 transition-colors"
                  : isUnmanaged
                  ? "border-b border-slate-700/50 bg-red-900/10 hover:bg-red-900/20 transition-colors"
                  : "border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors";
                return (
                  <tr key={i} className={rowClass}>
                    <td className="px-4 py-3 font-mono font-semibold text-white">
                      {p.symbol}
                      {p.orphaned && <OrphanedBadge />}
                      <ManagementBadge origin={p.origin} managementStatus={p.managementStatus} />
                    </td>
                    <td className="px-4 py-3 text-slate-400">{p.assetClass}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs capitalize">{strategyLabel}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {fmtTime(p.openedAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(p.quantity, 4)}</td>
                    <td className="px-4 py-3 text-right font-mono">${fmt(p.entryPrice)}</td>
                    <td className="px-4 py-3 text-right font-mono">${fmt(p.currentPrice)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">
                      {p.stopLoss != null ? `$${fmt(p.stopLoss)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">
                      {p.takeProfit != null ? `$${fmt(p.takeProfit)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {p.riskAmount != null ? `$${fmt(p.riskAmount)}` : "—"}
                    </td>
                    <PnlCell value={p.unrealizedPnl} />
                    <td className={`px-4 py-3 text-right font-mono ${pctColor}`}>
                      {pnlPct != null
                        ? `${pnlPct > 0 ? "+" : ""}${fmt(pnlPct, 2)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
