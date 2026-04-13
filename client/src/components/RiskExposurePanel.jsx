import { useExposure } from "../hooks/queries/useAnalytics.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ProgressBar({ pct, danger }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const barColor = danger ? "bg-red-500" : clamped > 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export default function RiskExposurePanel() {
  const { data, isLoading } = useExposure();

  const dailyLossLimitPct = toNumber(import.meta.env.VITE_DAILY_LOSS_LIMIT_PCT, 2);

  if (isLoading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 animate-pulse h-32" />
    );
  }

  const totalOpenRiskPct = toNumber(data?.totalOpenRiskPct, 0) * 100;
  const openCount = toNumber(data?.openPositionCount, 0);
  const unrealizedPnl = toNumber(data?.unrealizedPnl, 0);
  const totalOpenRisk = toNumber(data?.totalOpenRisk, 0);

  const stockCount = toNumber(data?.byAssetClass?.stock?.count, 0);
  const cryptoCount = toNumber(data?.byAssetClass?.crypto?.count, 0);

  // Daily loss gauge is not directly available here without a separate hook;
  // show open risk as a proxy.
  const riskBarDanger = totalOpenRiskPct > 3;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">Risk Exposure</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-400">Open Risk</p>
          <p className="text-lg font-bold text-white">{totalOpenRiskPct.toFixed(2)}%</p>
          <ProgressBar pct={totalOpenRiskPct} danger={riskBarDanger} />
          <p className="text-xs text-slate-500 mt-0.5">${totalOpenRisk.toFixed(2)} at risk</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Open Positions</p>
          <p className="text-lg font-bold text-white">{openCount}</p>
          <p className="text-xs text-slate-500">
            {stockCount} stock · {cryptoCount} crypto
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Unrealized P&amp;L</p>
          <p className={`text-lg font-bold ${unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Daily Loss Limit</p>
          <p className="text-lg font-bold text-slate-300">{dailyLossLimitPct}%</p>
          <p className="text-xs text-slate-500">hard stop</p>
        </div>
      </div>
    </div>
  );
}
