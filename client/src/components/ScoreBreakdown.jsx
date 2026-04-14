const GRADE_COLORS = {
  A: "text-green-600",
  B: "text-yellow-600",
  C: "text-red-500",
};

function Bar({ label, value, max = 25 }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-right text-gray-500 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 bg-blue-500 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-gray-700 shrink-0 tabular-nums">
        {value}/{max}
      </span>
    </div>
  );
}

export default function ScoreBreakdown({ total, grade, breakdown }) {
  if (!breakdown) return null;
  const gradeColor = GRADE_COLORS[grade] ?? "text-gray-600";

  return (
    <div className="space-y-1.5">
      <Bar label="Momentum" value={breakdown.momentum ?? 0} />
      <Bar label="Volume" value={breakdown.volume ?? 0} />
      <Bar label="ATR" value={breakdown.atrQuality ?? 0} />
      <Bar label="R:R" value={breakdown.riskReward ?? 0} />
      <div className="border-t border-gray-100 pt-1 flex items-center justify-between text-xs font-medium">
        <span className="text-gray-500">Total</span>
        <span>
          <span className="text-gray-800">{total ?? 0}/100</span>
          {grade && (
            <span className={`ml-2 font-bold ${gradeColor}`}>Grade: {grade}</span>
          )}
        </span>
      </div>
    </div>
  );
}
