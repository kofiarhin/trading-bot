import { useParams, useNavigate } from "react-router-dom";
import { useTradeDetail } from "../hooks/queries/useJournal.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(n, { sign = false } = {}) {
  if (n == null) return "—";
  const prefix = sign ? (n >= 0 ? "+" : "-") : n < 0 ? "-" : "";
  return `${prefix}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(4)}%`;
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function pnlColor(n) {
  if (n == null) return "text-slate-300";
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-300";
}

function formatAssetClass(raw) {
  if (!raw) return "—";
  const l = raw.toLowerCase();
  if (l === "us_equity" || l === "stock") return "Stock";
  if (l === "crypto") return "Crypto";
  return raw;
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function SectionCard({ title, children }) {
  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Field({ label, value, valueClass }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-medium ${valueClass ?? "text-slate-200"}`}>{value ?? "—"}</span>
    </div>
  );
}

function FieldGrid({ children }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">{children}</div>;
}

function StatusBadge({ status }) {
  const styles = {
    open: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    closed: "bg-slate-600/40 text-slate-300 border-slate-600",
    canceled: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2.5 py-1 rounded-md border text-sm font-semibold ${styles[status] ?? styles.closed}`}>
      {status}
    </span>
  );
}

// ─── Event Timeline ───────────────────────────────────────────────────────────

const EVENT_STYLES = {
  trade_pending: { dot: "bg-yellow-400", text: "text-slate-300" },
  trade_open:    { dot: "bg-sky-400",    text: "text-slate-200" },
  trade_closed:  { dot: "bg-emerald-400",text: "text-slate-200" },
  order_filled:  { dot: "bg-orange-400", text: "text-slate-200" },
  order_failed:  { dot: "bg-red-400",    text: "text-red-300"   },
};

function EventRow({ event }) {
  const style = EVENT_STYLES[event.type] ?? { dot: "bg-slate-500", text: "text-slate-400" };
  const label = event.label ?? event.type?.replace(/_/g, " ");
  const pnlLine = event.pnl != null ? ` · PnL: ${fmtUsd(event.pnl, { sign: true })}` : "";
  const reasonLine = event.reason ? ` · ${event.reason.replace(/_/g, " ")}` : "";

  return (
    <div className="flex items-start gap-3 px-5 py-3 hover:bg-slate-700/20 transition-colors">
      <div className="mt-1.5 shrink-0">
        <span className={`block w-2 h-2 rounded-full ${style.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${style.text}`}>
          {label}{reasonLine}{pnlLine}
        </p>
      </div>
      <span className="text-xs text-slate-500 shrink-0 font-mono mt-0.5">
        {fmtTime(event.timestamp)}
      </span>
    </div>
  );
}

function EventTimeline({ events = [] }) {
  return (
    <SectionCard title="Event Timeline">
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No events recorded.</p>
      ) : (
        <div className="divide-y divide-slate-700/50 -mx-5 -my-4">
          {[...events]
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .map((e, i) => (
              <EventRow key={e.id ?? e.eventId ?? i} event={e} />
            ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function OverviewSection({ trade }) {
  return (
    <SectionCard title="Overview">
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <span className="text-2xl font-bold font-mono text-white">{trade.symbol}</span>
        <StatusBadge status={trade.status} />
        <span className="text-sm text-slate-400">
          {formatAssetClass(trade.assetClass)} · {trade.strategyName ?? "—"} · {trade.side?.toUpperCase() ?? "BUY"}
        </span>
      </div>
      <FieldGrid>
        <Field label="Trade ID" value={<span className="font-mono text-xs">{trade.tradeId}</span>} />
        <Field label="Opened" value={fmtDateTime(trade.openedAt)} />
        {trade.closedAt && <Field label="Closed" value={fmtDateTime(trade.closedAt)} />}
        {trade.exitReason && (
          <Field label="Exit Reason" value={trade.exitReason.replace(/_/g, " ")} />
        )}
      </FieldGrid>
    </SectionCard>
  );
}

function EntryRiskSection({ trade }) {
  return (
    <SectionCard title="Entry / Risk">
      <FieldGrid>
        <Field label="Entry Price" value={fmtUsd(trade.entryPrice)} valueClass="text-white font-mono" />
        <Field label="Stop Loss" value={fmtUsd(trade.stopLoss)} valueClass="text-red-400 font-mono" />
        <Field label="Take Profit" value={fmtUsd(trade.takeProfit)} valueClass="text-emerald-400 font-mono" />
        <Field label="Quantity" value={trade.quantity ?? "—"} valueClass="text-white font-mono" />
        <Field label="Risk Amount" value={fmtUsd(trade.riskAmount)} />
        <Field label="Side" value={trade.side?.toUpperCase() ?? "—"} />
        <Field label="Source" value={trade.source ?? "—"} />
        {trade.brokerOrderId && (
          <Field label="Broker Order ID" value={<span className="font-mono text-xs">{trade.brokerOrderId}</span>} />
        )}
      </FieldGrid>
    </SectionCard>
  );
}

function ExitResultSection({ trade }) {
  if (trade.status === "pending" || trade.status === "open") {
    return (
      <SectionCard title="Exit / Result">
        <p className="text-sm text-slate-500">Trade is still {trade.status}.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Exit / Result">
      <FieldGrid>
        <Field label="Exit Price" value={fmtUsd(trade.exitPrice)} valueClass="text-white font-mono" />
        <Field
          label="PnL"
          value={fmtUsd(trade.pnl, { sign: true })}
          valueClass={pnlColor(trade.pnl) + " font-mono font-bold text-base"}
        />
        <Field label="PnL %" value={fmtPct(trade.pnlPct)} valueClass={pnlColor(trade.pnlPct) + " font-mono"} />
        <Field label="Closed At" value={fmtDateTime(trade.closedAt)} />
        {trade.exitReason && (
          <Field label="Exit Reason" value={trade.exitReason.replace(/_/g, " ")} />
        )}
      </FieldGrid>
    </SectionCard>
  );
}

function MetricsSection({ metrics }) {
  if (!metrics || Object.keys(metrics).length === 0) return null;

  const entries = [
    { label: "ATR", key: "atr" },
    { label: "Volume Ratio", key: "volumeRatio" },
    { label: "Breakout Level", key: "breakoutLevel" },
    { label: "Close Price", key: "closePrice" },
    { label: "Distance to Breakout", key: "distanceToBreakoutPct", suffix: "%" },
  ].filter(({ key }) => metrics[key] != null);

  if (entries.length === 0) return null;

  return (
    <SectionCard title="Metrics Snapshot">
      <FieldGrid>
        {entries.map(({ label, key, suffix }) => (
          <Field
            key={key}
            label={label}
            value={`${typeof metrics[key] === "number" ? metrics[key].toFixed(4) : metrics[key]}${suffix ?? ""}`}
            valueClass="text-slate-200 font-mono"
          />
        ))}
      </FieldGrid>
    </SectionCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TradeDetailPage() {
  const { tradeId } = useParams();
  const navigate = useNavigate();
  const { data: trade, isLoading, isError, error } = useTradeDetail(tradeId);

  if (isLoading) {
    return (
      <main className="px-4 py-6 md:px-8">
        <div className="max-w-screen-lg mx-auto">
          <div className="rounded-xl bg-slate-800 border border-slate-700 p-8 text-center text-slate-500">
            Loading trade…
          </div>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="px-4 py-6 md:px-8">
        <div className="max-w-screen-lg mx-auto space-y-4">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            ← Back to Journal
          </button>
          <div className="rounded-xl bg-slate-800 border border-slate-700 p-8 text-center text-red-400">
            {error?.message ?? "Trade not found."}
          </div>
        </div>
      </main>
    );
  }

  if (!trade) return null;

  return (
    <main className="px-4 py-6 md:px-8">
      <div className="max-w-screen-lg mx-auto space-y-5">
        {/* Back link */}
        <button
          onClick={() => navigate("/journal")}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Back to Journal
        </button>

        <OverviewSection trade={trade} />
        <EntryRiskSection trade={trade} />
        <ExitResultSection trade={trade} />
        <MetricsSection metrics={trade.metrics} />
        <EventTimeline events={trade.events ?? []} />
      </div>
    </main>
  );
}
