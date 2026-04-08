import { useSignals } from "../hooks/queries/useDashboard.js";

const STATUS_COLORS = {
  filled: "bg-emerald-900 text-emerald-300",
  pending: "bg-sky-900 text-sky-300",
  dry_run: "bg-slate-700 text-slate-300",
  failed: "bg-red-900 text-red-300",
};

function Badge({ status }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-700 text-slate-400";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {status ?? "—"}
    </span>
  );
}

function fmt(n, d = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export default function SignalsTable() {
  const { data: signals = [], isLoading } = useSignals();

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Today's Signals
        </h2>
      </div>

      {isLoading ? (
        <p className="p-5 text-slate-500 text-sm">Loading...</p>
      ) : signals.length === 0 ? (
        <p className="p-5 text-slate-500 text-sm">No signals recorded today.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-700">
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-right">Entry</th>
                <th className="px-4 py-3 text-right">Stop</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-white">{s.symbol}</td>
                  <td className="px-4 py-3 text-slate-400 capitalize">{s.assetClass}</td>
                  <td className="px-4 py-3"><Badge status={s.orderStatus} /></td>
                  <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={s.reason}>{s.reason}</td>
                  <td className="px-4 py-3 text-right font-mono">${fmt(s.entryPrice)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-400">${fmt(s.stopLoss)}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">${fmt(s.takeProfit)}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
