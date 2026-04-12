import { useActivity } from "../hooks/queries/useDashboard.js";

const TYPE_STYLES = {
  // Cycle events
  cycle_complete: { dot: "bg-sky-400", text: "text-slate-200" },
  skipped: { dot: "bg-slate-600", text: "text-slate-500" },
  failed: { dot: "bg-red-400", text: "text-red-300" },
  // Decision events
  approved: { dot: "bg-emerald-400", text: "text-slate-200" },
  rejected: { dot: "bg-red-500/70", text: "text-slate-400" },
  // Order events
  order_filled: { dot: "bg-orange-400", text: "text-slate-200" },
  order_failed: { dot: "bg-red-400", text: "text-red-300" },
  dry_run: { dot: "bg-slate-400", text: "text-slate-300" },
  // Trade lifecycle events
  trade_opened: { dot: "bg-emerald-500", text: "text-emerald-300" },
  trade_closed: { dot: "bg-slate-400", text: "text-slate-300" },
  stop_loss_hit: { dot: "bg-red-500", text: "text-red-300" },
  take_profit_hit: { dot: "bg-emerald-400", text: "text-emerald-300" },
  broker_sync_close: { dot: "bg-slate-500", text: "text-slate-400" },
  orphan_detected: { dot: "bg-yellow-500", text: "text-yellow-300" },
  sync_warning: { dot: "bg-yellow-600", text: "text-yellow-400" },
  // Legacy fallbacks
  cycle: { dot: "bg-sky-400", text: "text-slate-200" },
  signal: { dot: "bg-emerald-400", text: "text-slate-200" },
  order: { dot: "bg-orange-400", text: "text-slate-200" },
};

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

export default function ActivityFeed() {
  const { data: events = [], isLoading } = useActivity();

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Activity Feed
        </h2>
      </div>

      <div className="divide-y divide-slate-700/50 max-h-80 overflow-y-auto">
        {isLoading ? (
          <p className="p-5 text-slate-500 text-sm">Loading...</p>
        ) : events.length === 0 ? (
          <p className="p-5 text-slate-500 text-sm">No activity today.</p>
        ) : (
          events.map((e, i) => {
            const style = TYPE_STYLES[e.type] ?? TYPE_STYLES.skipped;
            return (
              <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-700/20 transition-colors">
                <div className="mt-1.5 shrink-0">
                  <span className={`block w-2 h-2 rounded-full ${style.dot}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${style.text}`}>{e.label}</p>
                </div>
                <span className="text-xs text-slate-500 shrink-0 font-mono mt-0.5">
                  {fmtTime(e.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
