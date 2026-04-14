const STAGE_STYLES = {
  pre_filter: "bg-gray-100 text-gray-600",
  shortlisted: "bg-blue-100 text-blue-700",
  strategy: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  risk_guard: "bg-orange-100 text-orange-700",
  ranked_out: "bg-slate-100 text-slate-600",
  execution: "bg-purple-100 text-purple-700",
};

const STAGE_LABELS = {
  pre_filter: "Pre-filtered",
  shortlisted: "Shortlisted",
  strategy: "Strategy",
  approved: "Approved",
  risk_guard: "Risk Guard",
  ranked_out: "Ranked Out",
  execution: "Execution",
};

export default function StageBadge({ stage }) {
  const styles = STAGE_STYLES[stage] ?? "bg-gray-100 text-gray-500";
  const label = STAGE_LABELS[stage] ?? stage ?? "—";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}
