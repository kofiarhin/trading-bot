import { useState } from "react";
import StageBadge from "./StageBadge.jsx";
import ScoreBreakdown from "./ScoreBreakdown.jsx";

const GRADE_COLORS = {
  A: "bg-green-100 text-green-700",
  B: "bg-yellow-100 text-yellow-700",
  C: "bg-red-100 text-red-600",
};

function fmt(n, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toFixed(decimals);
}

function resolveStage(candidate) {
  if (candidate.rejectStage === "pre_filter" || candidate.stage === "pre_filter") return "pre_filter";
  if (candidate.rejectStage === "ranked_out" || candidate.rankedOut || candidate.reason === "ranked_out") return "ranked_out";
  return candidate.stage ?? candidate.rejectStage ?? "strategy";
}

function CandidateRow({ candidate }) {
  const [expanded, setExpanded] = useState(false);
  const stage = resolveStage(candidate);

  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <td className="px-3 py-2 text-sm text-gray-500 text-right">{candidate.rank ?? "—"}</td>
        <td className="px-3 py-2 text-sm font-medium text-gray-900">{candidate.symbol}</td>
        <td className="px-3 py-2 text-sm text-right">
          {candidate.setupScore != null || candidate.score != null ? (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${GRADE_COLORS[candidate.setupGrade] ?? "bg-gray-100 text-gray-600"}`}>
              {candidate.score ?? candidate.setupScore} {candidate.setupGrade && <span>({candidate.setupGrade})</span>}
            </span>
          ) : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">
          {candidate.shortlisted ? <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">shortlisted</span> : "—"}
          {candidate.rankedOut ? <span className="ml-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700">ranked out</span> : null}
        </td>
        <td className="px-3 py-2"><StageBadge stage={stage} /></td>
        <td className="px-3 py-2 text-xs text-gray-500">{candidate.reason ?? "—"}</td>
      </tr>
      {expanded && candidate.scoreBreakdown && (
        <tr>
          <td colSpan={6} className="px-3 py-2 bg-gray-50">
            <div className="max-w-xs">
              <ScoreBreakdown
                total={candidate.score ?? candidate.setupScore}
                grade={candidate.setupGrade}
                breakdown={candidate.scoreBreakdown}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Section({ title, candidates, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!candidates.length) return null;
  return (
    <div className="mb-4">
      <button
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1 hover:text-gray-900"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? "▾" : "▸"}</span>
        {title}
        <span className="text-gray-400 font-normal">({candidates.length})</span>
      </button>
      {open && (
        <table className="w-full text-left text-sm border border-gray-100 rounded overflow-hidden">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-right">Rank</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {candidates.map((c, i) => (
              <CandidateRow key={c.symbol + (c.timestamp ?? i)} candidate={c} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function CandidateList({ data = null, candidates = [] }) {
  const payload = data ?? { shortlisted: candidates, rankedOut: [], strategyRejected: [], riskBlocked: [], approved: [], placed: [], otherStageDecisions: [] };
  const allCount = payload.shortlisted.length + payload.rankedOut.length + payload.strategyRejected.length + payload.riskBlocked.length + payload.approved.length + payload.placed.length + payload.otherStageDecisions.length;

  if (!allCount) {
    return <p className="text-sm text-gray-400 italic">No candidates this cycle.</p>;
  }

  return (
    <div>
      <Section title="Shortlisted" candidates={payload.shortlisted} defaultOpen={true} />
      <Section title="Ranked Out" candidates={payload.rankedOut} defaultOpen={false} />
      <Section title="Strategy Rejected" candidates={payload.strategyRejected} defaultOpen={true} />
      <Section title="Risk Blocked" candidates={payload.riskBlocked} defaultOpen={true} />
      <Section title="Approved" candidates={payload.approved} defaultOpen={false} />
      <Section title="Placed" candidates={payload.placed} defaultOpen={false} />
      <Section title="Other" candidates={payload.otherStageDecisions} defaultOpen={false} />
    </div>
  );
}
