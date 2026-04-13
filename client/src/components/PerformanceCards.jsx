import { usePerformance } from "../hooks/queries/useAnalytics.js";

function StatCard({ label, value, sub, positive }) {
  const colorClass =
    positive === true
      ? "text-emerald-400"
      : positive === false
      ? "text-red-400"
      : "text-white";

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PerformanceCards({ days = 30 }) {
  const { data, isLoading } = usePerformance(days);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-lg p-4 animate-pulse h-20" />
        ))}
      </div>
    );
  }

  const expectancy = data?.expectancy ?? 0;
  const profitFactor = data?.profitFactor ?? 0;
  const winRate = data?.winRate ?? 0;
  const totalTrades = data?.totalTrades ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label="Expectancy"
        value={`${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}R`}
        sub={`last ${days}d`}
        positive={expectancy > 0 ? true : expectancy < 0 ? false : undefined}
      />
      <StatCard
        label="Profit Factor"
        value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"}
        sub={profitFactor >= 1.5 ? "healthy" : profitFactor >= 1 ? "marginal" : "unprofitable"}
        positive={profitFactor >= 1.5 ? true : profitFactor < 1 ? false : undefined}
      />
      <StatCard
        label="Win Rate"
        value={`${(winRate * 100).toFixed(1)}%`}
        sub={`${data?.wins ?? 0}W / ${data?.losses ?? 0}L`}
        positive={winRate >= 0.5 ? true : undefined}
      />
      <StatCard
        label="Total Trades"
        value={totalTrades}
        sub={`avg W: ${(data?.avgWinR ?? 0).toFixed(2)}R  avg L: ${(data?.avgLossR ?? 0).toFixed(2)}R`}
      />
    </div>
  );
}
