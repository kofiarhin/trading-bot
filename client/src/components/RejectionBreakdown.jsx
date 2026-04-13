import { useRejections } from "../hooks/queries/useAnalytics.js";

const CLASS_LABELS = {
  no_signal: "No Signal",
  weak_conditions: "Weak Conditions",
  sizing_error: "Sizing / Data Error",
  unknown: "Other",
};

const CLASS_COLORS = {
  no_signal: "bg-slate-600",
  weak_conditions: "bg-amber-700",
  sizing_error: "bg-red-800",
  unknown: "bg-slate-700",
};

function Bar({ label, count, total, colorClass }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">{count}</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2">
        <div className={`h-2 rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RejectionBreakdown({ days = 7 }) {
  const { data, isLoading } = useRejections(days);

  if (isLoading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 animate-pulse h-40" />
    );
  }

  const byClass = data?.byClass ?? {};
  const total = Object.values(byClass).reduce((sum, n) => sum + n, 0);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">
        Rejections — last {days}d
        {total > 0 && <span className="text-slate-500 font-normal ml-2">({total} total)</span>}
      </h2>
      {total === 0 ? (
        <p className="text-sm text-slate-500">No rejections recorded.</p>
      ) : (
        Object.entries(CLASS_LABELS).map(([cls, label]) =>
          byClass[cls] ? (
            <Bar
              key={cls}
              label={label}
              count={byClass[cls]}
              total={total}
              colorClass={CLASS_COLORS[cls] ?? "bg-slate-600"}
            />
          ) : null,
        )
      )}
    </div>
  );
}
