import { useLatestCycle } from "../hooks/queries/useDashboard.js";
import { useCycleRuntime } from "../hooks/queries/useCycleRuntime.js";

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
  const { data: runtime } = useCycleRuntime();

  const isRunning = runtime?.status === "running";

  const panelData = isRunning
    ? {
        startTime: runtime.startedAt,
        endTime: null,
        durationMs: runtime.startedAt ? Date.now() - new Date(runtime.startedAt).getTime() : null,
        stage: runtime.stage,
        progressPct: runtime.progressPct,
        symbolCount: runtime.symbolCount,
        scanned: runtime.scanned,
        approved: runtime.approved,
        rejected: runtime.rejected,
        placed: runtime.placed,
        errors: runtime.errors,
      }
    : cycle;

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-5">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
        {isRunning ? "Current Cycle" : "Last Cycle"}
      </h2>

      {isLoading && !panelData ? (
        <p className="text-slate-500 text-sm">Loading...</p>
      ) : !panelData ? (
        <p className="text-slate-500 text-sm">No cycle data for today.</p>
      ) : (
        <div>
          <Row label="Start" value={fmtTime(panelData.startTime)} />
          <Row label="End" value={fmtTime(panelData.endTime)} />
          <Row label="Duration" value={fmtDuration(panelData.durationMs)} color="text-slate-300" />
          <Row label="Stage" value={panelData.stage ? panelData.stage.replaceAll("_", " ") : "—"} color="text-slate-300" />
          <Row label="Progress" value={panelData.progressPct != null ? `${panelData.progressPct}%` : "—"} color="text-sky-300" />
          <Row label="Symbols" value={panelData.symbolCount} />
          <Row label="Scanned" value={panelData.scanned} />
          <Row label="Approved" value={panelData.approved} color="text-emerald-400" />
          <Row label="Rejected" value={panelData.rejected} color="text-red-400" />
          <Row label="Placed" value={panelData.placed} color="text-sky-400" />
          <Row
            label="Errors"
            value={panelData.errors}
            color={panelData.errors > 0 ? "text-red-400" : "text-slate-400"}
          />
        </div>
      )}
    </div>
  );
}
