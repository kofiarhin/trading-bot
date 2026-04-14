import { useConversionStats } from "../hooks/queries/useAnalytics.js";

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

export default function ConversionFunnel({ days = 7 }) {
  const { data, isLoading, isError } = useConversionStats(days);

  if (isLoading) return <p className="text-xs text-gray-400">Loading funnel…</p>;
  if (isError || !data) return <p className="text-xs text-red-400">Failed to load funnel.</p>;

  const steps = [
    { label: "Scanned", count: data.totalScanned, rate: null },
    { label: "Pre-filter Passed", count: data.preFilterPassed, rate: data.preFilterRate },
    { label: "Shortlisted", count: data.shortlisted, rate: data.shortlistRate },
    { label: "Approved", count: data.strategyApproved, rate: data.approvalRate },
    { label: "Placed", count: data.placed, rate: data.placementRate },
  ];

  return (
    <div className="flex flex-col items-center gap-0 py-2">
      <p className="text-xs text-gray-400 mb-3">Last {days} days</p>
      {steps.map((step, i) => (
        <FunnelStep
          key={step.label}
          label={step.label}
          count={step.count}
          rate={step.rate}
          isFirst={i === 0}
        />
      ))}
    </div>
  );
}
