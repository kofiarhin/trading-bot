import { useRejections } from "../hooks/queries/useAnalytics.js";

// ── Grouped category config ────────────────────────────────────────────────────
const GROUP_LABELS = {
  signal_quality: "Signal Quality",
  data_quality: "Data Quality",
  execution_guard: "Execution Guard",
  risk_guard: "Risk Guard",
};

const GROUP_COLORS = {
  signal_quality: "bg-amber-600",
  data_quality: "bg-slate-500",
  execution_guard: "bg-red-700",
  risk_guard: "bg-violet-700",
};

// ── Legacy class config (kept for historical records) ─────────────────────────
const CLASS_LABELS = {
  no_signal: "No Signal",
  weak_conditions: "Weak Conditions",
  sizing_error: "Sizing / Data Error",
  data_quality: "Data Quality",
  unknown: "Other",
};

const CLASS_COLORS = {
  no_signal: "bg-slate-600",
  weak_conditions: "bg-amber-700",
  sizing_error: "bg-red-800",
  data_quality: "bg-slate-500",
  unknown: "bg-slate-700",
};

// ── Exact reason display labels ───────────────────────────────────────────────
const REASON_LABELS = {
  no_breakout: "No Breakout",
  near_breakout: "Near Breakout",
  overextended_breakout: "Overextended",
  breakout_too_extended: "Overextended (legacy)",
  weak_volume: "Weak Volume",
  missing_volume: "Missing Volume",
  atr_too_low: "ATR Too Low",
  weak_risk_reward: "Weak R:R",
  invalid_risk_reward: "Invalid R:R (legacy)",
  score_below_threshold: "Score Below Threshold",
  insufficient_market_data: "Insufficient Data",
  invalid_stop_distance: "Invalid Stop Distance",
  invalid_position_size: "Invalid Position Size",
  duplicate_position_guard: "Duplicate Position",
  max_positions_guard: "Max Positions",
  daily_loss_guard: "Daily Loss Limit",
  cooldown_guard: "Cooldown Active",
};

const GROUP_REASON_COLORS = {
  signal_quality: "bg-amber-600/70",
  data_quality: "bg-slate-500/70",
  execution_guard: "bg-red-700/70",
  risk_guard: "bg-violet-700/70",
};

function Bar({ label, count, total, colorClass, sublabel }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-300">
          {label}
          {sublabel && <span className="text-slate-500 ml-1.5 text-[10px]">{sublabel}</span>}
        </span>
        <span className="text-slate-400 tabular-nums">{count}</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RejectionBreakdown({ days = 7 }) {
  const { data, isLoading } = useRejections(days);

  if (isLoading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 animate-pulse h-48" />
    );
  }

  const byGroup = data?.byGroup ?? {};
  const byClass = data?.byClass ?? {};
  const topReasons = data?.topReasons ?? [];
  const total = data?.total ?? Object.values(byClass).reduce((s, n) => s + n, 0);

  // Prefer byGroup if available (new data), fall back to byClass (old records)
  const hasGroupData = Object.keys(byGroup).length > 0;
  const groupTotal = Object.values(byGroup).reduce((s, n) => s + n, 0);
  const classTotal = Object.values(byClass).reduce((s, n) => s + n, 0);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">
          Rejections — last {days}d
        </h2>
        {total > 0 && (
          <span className="text-xs text-slate-500">{total} total</span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-sm text-slate-500">No rejections recorded.</p>
      ) : (
        <>
          {/* ── Grouped categories ── */}
          {hasGroupData && groupTotal > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">By Category</p>
              {Object.entries(GROUP_LABELS).map(([group, label]) =>
                byGroup[group] ? (
                  <Bar
                    key={group}
                    label={label}
                    count={byGroup[group]}
                    total={groupTotal}
                    colorClass={GROUP_COLORS[group] ?? "bg-slate-600"}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* ── Legacy class view fallback ── */}
          {!hasGroupData && classTotal > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">By Class</p>
              {Object.entries(CLASS_LABELS).map(([cls, label]) =>
                byClass[cls] ? (
                  <Bar
                    key={cls}
                    label={label}
                    count={byClass[cls]}
                    total={classTotal}
                    colorClass={CLASS_COLORS[cls] ?? "bg-slate-600"}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* ── Top exact reasons ── */}
          {topReasons.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Top Reasons</p>
              {topReasons.map(({ reason, count, group }) => (
                <Bar
                  key={reason}
                  label={REASON_LABELS[reason] ?? reason.replace(/_/g, " ")}
                  sublabel={GROUP_LABELS[group] ?? group}
                  count={count}
                  total={total}
                  colorClass={GROUP_REASON_COLORS[group] ?? "bg-slate-600"}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
