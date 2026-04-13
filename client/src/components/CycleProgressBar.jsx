export default function CycleProgressBar({ runtime }) {
  if (!runtime || runtime.status !== 'running') return null;

  const pct = Math.max(0, Math.min(100, Number(runtime.progressPct ?? 0)));
  const stageLabel = runtime.stage ? runtime.stage.replaceAll('_', ' ') : 'running';

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">Cycle in progress</p>
        <p className="text-xs text-sky-300">{pct}%</p>
      </div>
      <div className="w-full h-2 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-sky-400 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-slate-200 capitalize">{stageLabel}</p>
        <p className="text-xs text-slate-400">
          scanned: {runtime.metrics?.scanned ?? 0} · approved: {runtime.metrics?.approved ?? 0} · placed: {runtime.metrics?.placed ?? 0}
        </p>
      </div>
    </div>
  );
}
