import { useCandidates } from "../hooks/queries/useAnalytics.js";

function FunnelStep({ label, count, rate, isFirst }) {
  return (
    <div className="flex flex-col items-center">
      {!isFirst && (
        <div className="flex flex-col items-center text-gray-300 my-0.5">
          <span className="text-xs font-medium text-gray-400">
            {rate != null ? `${(rate * 100).toFixed(1)}%` : ""}
          </span>
          <span className="text-lg leading-none">↓</span>
        </div>
      )}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 text-center min-w-[90px]">
        <div className="text-lg font-bold text-blue-700">{count ?? 0}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function ratio(num, den) {
  if (!den) return null;
  return num / den;
}

export default function ConversionFunnel({ cycleId }) {
  const { data, isLoading, isError } = useCandidates(cycleId);

  if (isLoading) return <p className="text-xs text-gray-400">Loading funnel…</p>;
  if (isError || !data) return <p className="text-xs text-red-400">Failed to load funnel.</p>;

  const totals = data.totals ?? {};

  const steps = [
    { label: "Scanned", count: totals.scanned ?? 0, rate: null },
    { label: "Scored", count: totals.scored ?? 0, rate: ratio(totals.scored ?? 0, totals.scanned ?? 0) },
    { label: "Shortlisted", count: totals.shortlisted ?? 0, rate: ratio(totals.shortlisted ?? 0, totals.scored ?? 0) },
    { label: "Approved", count: totals.approved ?? 0, rate: ratio(totals.approved ?? 0, totals.shortlisted ?? 0) },
    { label: "Placed", count: totals.placed ?? 0, rate: ratio(totals.placed ?? 0, totals.approved ?? 0) },
  ];

  return (
    <div className="flex flex-col items-center gap-0 py-2">
      <p className="text-xs text-gray-400 mb-3">Cycle: {data.cycleId ?? "latest"}</p>
      {steps.map((step, i) => (
        <FunnelStep key={step.label} label={step.label} count={step.count} rate={step.rate} isFirst={i === 0} />
      ))}
    </div>
  );
}
