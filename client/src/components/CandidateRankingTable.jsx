import { useCandidates } from "../hooks/queries/useAnalytics.js";
import StageBadge from "./StageBadge.jsx";

const GRADE_STYLES = {
  A: "bg-emerald-900 text-emerald-300 border border-emerald-700",
  B: "bg-sky-900 text-sky-300 border border-sky-700",
  C: "bg-slate-700 text-slate-300 border border-slate-600",
};

function GradeBadge({ grade }) {
  if (!grade) return <span className="text-slate-500">—</span>;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${GRADE_STYLES[grade] ?? GRADE_STYLES.C}`}>
      {grade}
    </span>
  );
}

function rankRows(payload) {
  return [
    ...payload.shortlisted,
    ...payload.rankedOut,
    ...payload.strategyRejected,
    ...payload.riskBlocked,
    ...payload.otherStageDecisions,
  ];
}

export default function CandidateRankingTable({ cycleId }) {
  const { data, isLoading } = useCandidates(cycleId);
  const rows = data ? rankRows(data) : [];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3">Candidate Ranking</h2>
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 bg-slate-700 rounded animate-pulse" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-slate-500">No candidates this cycle.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-700">
                <th className="text-left py-1.5 pr-3">#</th>
                <th className="text-left py-1.5 pr-3">Symbol</th>
                <th className="text-left py-1.5 pr-3">Stage</th>
                <th className="text-left py-1.5 pr-3">Grade</th>
                <th className="text-right py-1.5 pr-3">Score</th>
                <th className="text-right py-1.5 pr-3">R:R</th>
                <th className="text-right py-1.5">Entry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, idx) => (
                <tr key={`${c.symbol}-${c.timestamp ?? idx}`} className="border-b border-slate-700/50 last:border-0">
                  <td className="py-1.5 pr-3 text-slate-500">{c.rank ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono text-white">{c.symbol}</td>
                  <td className="py-1.5 pr-3"><StageBadge stage={c.rejectStage ?? c.stage ?? "strategy"} /></td>
                  <td className="py-1.5 pr-3">
                    <GradeBadge grade={c.setupGrade} />
                  </td>
                  <td className="py-1.5 pr-3 text-right text-slate-300">{c.score ?? c.setupScore ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-300">
                    {c.metrics?.riskReward != null ? `${Number(c.metrics.riskReward).toFixed(2)}×` : "—"}
                  </td>
                  <td className="py-1.5 text-right text-slate-300">
                    {c.metrics?.closePrice != null ? `$${Number(c.metrics.closePrice).toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
