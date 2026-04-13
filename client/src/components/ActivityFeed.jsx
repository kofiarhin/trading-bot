import { useState } from "react";
import { useActivity } from "../hooks/queries/useDashboard.js";

const TYPE_STYLES = {
  cycle_complete: { dot: "bg-sky-400", text: "text-slate-200" },
  cycle_started: { dot: "bg-cyan-400", text: "text-slate-200" },
  skipped: { dot: "bg-slate-600", text: "text-slate-500" },
  failed: { dot: "bg-red-400", text: "text-red-300" },
  approved: { dot: "bg-emerald-400", text: "text-slate-200" },
  rejected: { dot: "bg-red-500/70", text: "text-slate-400" },
  order_filled: { dot: "bg-orange-400", text: "text-slate-200" },
  order_failed: { dot: "bg-red-400", text: "text-red-300" },
  dry_run: { dot: "bg-slate-400", text: "text-slate-300" },
  trade_opened: { dot: "bg-emerald-500", text: "text-emerald-300" },
  trade_closed: { dot: "bg-slate-400", text: "text-slate-300" },
  stop_loss_hit: { dot: "bg-red-500", text: "text-red-300" },
  take_profit_hit: { dot: "bg-emerald-400", text: "text-emerald-300" },
  broker_sync_close: { dot: "bg-slate-500", text: "text-slate-400" },
  orphan_detected: { dot: "bg-yellow-500", text: "text-yellow-300" },
  sync_warning: { dot: "bg-yellow-600", text: "text-yellow-400" },
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

const DASHBOARD_PREVIEW_PARAMS = { limit: 10 };

export default function ActivityFeed({ variant = "desktop", previewCount = 5 }) {
  const { data, isLoading } = useActivity(DASHBOARD_PREVIEW_PARAMS);
  const events = data?.items ?? [];
  const [expanded, setExpanded] = useState(false);

  const isMobile = variant === "mobile";
  const visibleEvents = isMobile && !expanded ? events.slice(0, previewCount) : events;
  const hasMore = isMobile && events.length > previewCount;

  return (
    <div className={`rounded-xl bg-slate-800 border border-slate-700 overflow-hidden ${isMobile ? "border-0 rounded-none" : ""}`}>
      <div className={`${isMobile ? "px-4 py-3" : "px-5 py-4"} border-b border-slate-700`}>
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Activity Feed</h2>
      </div>

      <div className={`divide-y divide-slate-700/50 ${isMobile ? "" : "max-h-80 overflow-y-auto"}`}>
        {isLoading ? (
          <p className={`${isMobile ? "px-4 py-3" : "p-5"} text-slate-500 text-sm`}>Loading...</p>
        ) : events.length === 0 ? (
          <p className={`${isMobile ? "px-4 py-3" : "p-5"} text-slate-500 text-sm`}>No activity today.</p>
        ) : (
          visibleEvents.map((e, i) => {
            const style = TYPE_STYLES[e.type] ?? TYPE_STYLES.skipped;
            return (
              <div key={i} className={`flex items-start gap-2.5 ${isMobile ? "px-4 py-2" : "px-5 py-3 hover:bg-slate-700/20"} transition-colors`}>
                <div className="mt-1.5 shrink-0">
                  <span className={`block w-2 h-2 rounded-full ${style.dot}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`${isMobile ? "text-xs" : "text-sm"} leading-snug ${style.text} ${isMobile ? "truncate" : ""}`} title={e.label}>
                    {e.label}
                  </p>
                </div>
                <span className={`text-[11px] text-slate-500 shrink-0 font-mono ${isMobile ? "mt-0.5" : ""}`}>
                  {fmtTime(e.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full px-4 py-2.5 text-xs font-medium text-sky-300 hover:text-sky-200 bg-slate-900/40 border-t border-slate-700"
        >
          {expanded ? "Show Less" : `View All (${events.length})`}
        </button>
      )}
    </div>
  );
}
