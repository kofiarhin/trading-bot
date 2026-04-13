export default function CycleProgressBar({ runtime }) {
  if (!runtime || runtime.status !== 'running') return null;

  const pct = Math.max(0, Math.min(100, Number(runtime.progressPct ?? 0)));
  const stageLabel = runtime.stage ? runtime.stage.replaceAll('_', ' ') : 'running';

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-4">
      <style>{`
        @keyframes cycleProgressShimmer {
          0% { transform: translateX(-140%); opacity: 0; }
          20% { opacity: 0.2; }
          50% { opacity: 0.35; }
          100% { transform: translateX(140%); opacity: 0; }
        }
      `}</style>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">Cycle in progress</p>
        <p className="text-xs text-sky-300">{pct}%</p>
      </div>
      <div className="w-full h-2 rounded-full bg-slate-700/90 overflow-hidden relative">
        <div
          className="h-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none"
          style={{ animation: 'cycleProgressShimmer 2.4s linear infinite' }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-slate-200 capitalize">{runtime.message ?? stageLabel}</p>
        <p className="text-xs text-slate-400">
          scanned: {runtime.scanned ?? runtime.metrics?.scanned ?? 0} · approved: {runtime.approved ?? runtime.metrics?.approved ?? 0} · placed: {runtime.placed ?? runtime.metrics?.placed ?? 0}
        </p>
      </div>
    </div>
  );
}
