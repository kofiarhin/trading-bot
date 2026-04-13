import { useLatestCycle } from "../hooks/queries/useDashboard.js";

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-700 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`text-sm font-medium ${color ?? "text-white"}`}>{value ?? "—"}</span>
    </div>
  );
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

function fmtDuration(ms) {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function LastCyclePanel() {
  const { data: cycle, isLoading } = useLatestCycle();

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-5">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
        Last Cycle
      </h2>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading...</p>
      ) : !cycle ? (
        <p className="text-slate-500 text-sm">No cycle data for today.</p>
      ) : (
        <div>
          <Row label="Start" value={fmtTime(cycle.startTime)} />
          <Row label="End" value={fmtTime(cycle.endTime)} />
          <Row label="Duration" value={fmtDuration(cycle.durationMs)} color="text-slate-300" />
          <Row label="Stage" value={cycle.stage ? cycle.stage.replaceAll("_", " ") : "—"} color="text-slate-300" />
          <Row label="Progress" value={cycle.progressPct != null ? `${cycle.progressPct}%` : "—"} color="text-sky-300" />
          <Row label="Scanned" value={cycle.scanned} />
          <Row label="Approved" value={cycle.approved} color="text-emerald-400" />
          <Row label="Rejected" value={cycle.rejected} color="text-red-400" />
          <Row label="Placed" value={cycle.placed} color="text-sky-400" />
          <Row
            label="Errors"
            value={cycle.errors}
            color={cycle.errors > 0 ? "text-red-400" : "text-slate-400"}
          />
        </div>
      )}
    </div>
  );
}
