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
  if (candidate.rejectStage === "ranked_out" || candidate.reason === "ranked_out") return "ranked_out";
  if (candidate.shortlisted && candidate.approved) return "approved";
  if (candidate.shortlisted) return "strategy";
  return candidate.stage ?? "pre_filter";
}

function groupCandidates(candidates) {
  const shortlisted = candidates.filter((c) => c.shortlisted && c.approved);
  const strategyRejected = candidates.filter((c) => c.shortlisted && !c.approved && c.rejectStage !== "ranked_out");
  const rankedOut = candidates.filter((c) => c.rejectStage === "ranked_out" || c.reason === "ranked_out");
  const preFiltered = candidates.filter((c) => c.rejectStage === "pre_filter" || c.stage === "pre_filter");
  return { shortlisted, strategyRejected, rankedOut, preFiltered };
}

function CandidateRow({ candidate }) {
  const [expanded, setExpanded] = useState(false);
  const stage = resolveStage(candidate);

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2 text-sm font-medium text-gray-900">{candidate.symbol}</td>
        <td className="px-3 py-2 text-sm text-gray-500 text-right">{candidate.rank ?? "—"}</td>
        <td className="px-3 py-2 text-sm text-right">
          {candidate.setupScore != null ? (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${GRADE_COLORS[candidate.setupGrade] ?? "bg-gray-100 text-gray-600"}`}>
              {candidate.setupScore} {candidate.setupGrade && <span>({candidate.setupGrade})</span>}
            </span>
          ) : "—"}
        </td>
        <td className="px-3 py-2"><StageBadge stage={stage} /></td>
        <td className="px-3 py-2 text-xs text-gray-500">{candidate.reason ?? "—"}</td>
        <td className="px-3 py-2 text-xs text-gray-700 text-right">{fmt(candidate.entryPrice)}</td>
        <td className="px-3 py-2 text-xs text-gray-700 text-right">{fmt(candidate.stopLoss)}</td>
        <td className="px-3 py-2 text-xs text-gray-700 text-right">{fmt(candidate.takeProfit)}</td>
      </tr>
      {expanded && candidate.scoreBreakdown && (
        <tr>
          <td colSpan={8} className="px-3 py-2 bg-gray-50">
            <div className="max-w-xs">
              <ScoreBreakdown
                total={candidate.setupScore}
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
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2 text-right">Rank</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2 text-right">Entry</th>
              <th className="px-3 py-2 text-right">Stop</th>
              <th className="px-3 py-2 text-right">Target</th>
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

export default function CandidateList({ candidates = [] }) {
  const { shortlisted, strategyRejected, rankedOut, preFiltered } = groupCandidates(candidates);

  if (!candidates.length) {
    return <p className="text-sm text-gray-400 italic">No candidates this cycle.</p>;
  }

  return (
    <div>
      <Section title="Shortlisted & Approved" candidates={shortlisted} defaultOpen={true} />
      <Section title="Strategy Rejected" candidates={strategyRejected} defaultOpen={true} />
      <Section title="Ranked Out" candidates={rankedOut} defaultOpen={false} />
      <Section title="Pre-filtered" candidates={preFiltered} defaultOpen={false} />
    </div>
  );
}
