import { useSearchParams } from "react-router-dom";
import { useDecisions, useActivity } from "../hooks/queries/useDashboard.js";

// ─── Shared UI helpers ─────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function PaginationControls({ pagination, onPageChange, onLimitChange }) {
  if (!pagination) return null;
  const { page, limit, total, pages, hasPrevPage, hasNextPage } = pagination;
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-700 text-xs text-slate-400">
      <span>
        {total === 0 ? "No results" : `${start}–${end} of ${total}`}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Rows:
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-1.5 py-0.5 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasPrevPage}
            onClick={() => onPageChange(page - 1)}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ‹ Prev
          </button>
          <span className="px-2 text-slate-300">
            {page} / {pages || 1}
          </span>
          <button
            type="button"
            disabled={!hasNextPage}
            onClick={() => onPageChange(page + 1)}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h2>
      {count != null && (
        <span className="text-xs text-slate-500">{count} total</span>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      {children ?? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 w-36"
        />
      )}
    </label>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs"
      >
        {options.map(({ value: v, label: l }) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

// ─── Decision History ──────────────────────────────────────────────────────────

const DECISION_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const ASSET_CLASS_OPTIONS = [
  { value: "", label: "All" },
  { value: "stock", label: "Stock" },
  { value: "crypto", label: "Crypto" },
];

function fmt(n, d = 4) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function DecisionBadge({ decision }) {
  const approved = decision === "Approved";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${approved ? "bg-emerald-900 text-emerald-300" : "bg-red-900/60 text-red-300"}`}>
      {decision}
    </span>
  );
}

function DecisionHistory({ searchParams, setSearchParams }) {
  const page = Number(searchParams.get("d_page") || 1);
  const limit = Number(searchParams.get("d_limit") || 25);
  const decision = searchParams.get("d_filter") || "";
  const symbol = searchParams.get("d_symbol") || "";
  const assetClass = searchParams.get("d_class") || "";

  function update(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "d_page") next.delete("d_page"); // reset page on filter change
      return next;
    });
  }

  const params = { page, limit };
  if (decision) params.decision = decision;
  if (symbol) params.symbol = symbol;
  if (assetClass) params.assetClass = assetClass;

  const { data, isLoading, isError } = useDecisions(params);
  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;

  return (
    <section className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <SectionHeader title="Decision History" count={pagination?.total} />

      {/* Filters */}
      <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap items-end gap-4">
        <FilterSelect
          label="Decision"
          value={decision}
          onChange={(v) => update("d_filter", v)}
          options={DECISION_FILTER_OPTIONS}
        />
        <FilterInput
          label="Symbol"
          value={symbol}
          onChange={(v) => update("d_symbol", v.toUpperCase())}
          placeholder="e.g. BTC"
        />
        <FilterSelect
          label="Asset Class"
          value={assetClass}
          onChange={(v) => update("d_class", v)}
          options={ASSET_CLASS_OPTIONS}
        />
        {summary && (
          <span className="ml-auto text-xs text-slate-400 self-end">
            <span className="text-emerald-400">{summary.approved} approved</span>
            {" · "}
            <span className="text-red-400">{summary.rejected} rejected</span>
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="p-5 text-slate-500 text-sm">Loading…</p>
      ) : isError ? (
        <p className="p-5 text-red-400 text-sm">Failed to load decisions.</p>
      ) : items.length === 0 ? (
        <p className="p-5 text-slate-500 text-sm">No decisions match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-700">
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Decision</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-right">Close</th>
                <th className="px-4 py-3 text-right">Breakout</th>
                <th className="px-4 py-3 text-right">ATR</th>
                <th className="px-4 py-3 text-right">Vol Ratio</th>
                <th className="px-4 py-3 text-right">Distance</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d, i) => (
                <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs whitespace-nowrap">{fmtTime(d.timestamp)}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-white">{d.symbol}</td>
                  <td className="px-4 py-3 text-slate-400">{d.assetClass ?? "—"}</td>
                  <td className="px-4 py-3"><DecisionBadge decision={d.decision} /></td>
                  <td className="px-4 py-3 text-slate-300 max-w-xs truncate" title={d.reason}>{d.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">
                    {d.closePrice != null ? `$${fmt(d.closePrice, 2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {d.breakoutLevel != null ? `$${fmt(d.breakoutLevel, 2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(d.atr, 4)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${d.volumeRatio != null && d.volumeRatio >= 1 ? "text-emerald-400" : "text-slate-400"}`}>
                    {d.volumeRatio != null ? `${fmt(d.volumeRatio, 2)}x` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {d.distanceToBreakoutPct != null && Number.isFinite(d.distanceToBreakoutPct)
                      ? `${d.distanceToBreakoutPct.toFixed(2)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationControls
        pagination={pagination}
        onPageChange={(p) => update("d_page", String(p))}
        onLimitChange={(l) => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("d_limit", String(l));
            next.delete("d_page");
            return next;
          });
        }}
      />
    </section>
  );
}

// ─── Activity History ──────────────────────────────────────────────────────────

const ACTIVITY_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "cycle_complete", label: "Cycle complete" },
  { value: "cycle_started", label: "Cycle started" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "trade_placed", label: "Trade placed" },
  { value: "trade_opened", label: "Trade opened" },
  { value: "trade_closed", label: "Trade closed" },
  { value: "stop_loss_hit", label: "Stop loss hit" },
  { value: "take_profit_hit", label: "Take profit hit" },
  { value: "order_filled", label: "Order filled" },
  { value: "order_failed", label: "Order failed" },
  { value: "dry_run", label: "Dry run" },
];

const TYPE_DOT = {
  cycle_complete: "bg-sky-400",
  cycle_started: "bg-sky-600",
  skipped: "bg-slate-600",
  failed: "bg-red-400",
  approved: "bg-emerald-400",
  rejected: "bg-red-500/70",
  order_filled: "bg-orange-400",
  order_failed: "bg-red-400",
  dry_run: "bg-slate-400",
  trade_opened: "bg-emerald-500",
  trade_closed: "bg-slate-400",
  trade_placed: "bg-orange-300",
  stop_loss_hit: "bg-red-500",
  take_profit_hit: "bg-emerald-400",
  broker_sync_close: "bg-slate-500",
  orphan_detected: "bg-yellow-500",
  sync_warning: "bg-yellow-600",
};

function ActivityHistory({ searchParams, setSearchParams }) {
  const page = Number(searchParams.get("a_page") || 1);
  const limit = Number(searchParams.get("a_limit") || 25);
  const type = searchParams.get("a_type") || "";
  const search = searchParams.get("a_search") || "";

  function update(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "a_page") next.delete("a_page");
      return next;
    });
  }

  const params = { page, limit };
  if (type) params.type = type;
  if (search) params.search = search;

  const { data, isLoading, isError } = useActivity(params);
  const items = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <section className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden">
      <SectionHeader title="Activity History" count={pagination?.total} />

      {/* Filters */}
      <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap items-end gap-4">
        <FilterSelect
          label="Type"
          value={type}
          onChange={(v) => update("a_type", v)}
          options={ACTIVITY_TYPE_OPTIONS}
        />
        <FilterInput
          label="Search"
          value={search}
          onChange={(v) => update("a_search", v)}
          placeholder="e.g. BTC, rejected"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <p className="p-5 text-slate-500 text-sm">Loading…</p>
      ) : isError ? (
        <p className="p-5 text-red-400 text-sm">Failed to load activity.</p>
      ) : items.length === 0 ? (
        <p className="p-5 text-slate-500 text-sm">No activity matches the current filters.</p>
      ) : (
        <div className="divide-y divide-slate-700/50">
          {items.map((e, i) => {
            const dot = TYPE_DOT[e.type] ?? "bg-slate-600";
            return (
              <div key={i} className="flex items-start gap-2.5 px-5 py-3 hover:bg-slate-700/20 transition-colors">
                <div className="mt-1.5 shrink-0">
                  <span className={`block w-2 h-2 rounded-full ${dot}`} />
                </div>
                <p className="flex-1 text-sm text-slate-200 leading-snug">{e.label}</p>
                <span className="text-[11px] text-slate-500 shrink-0 font-mono whitespace-nowrap">
                  {fmtTime(e.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <PaginationControls
        pagination={pagination}
        onPageChange={(p) => update("a_page", String(p))}
        onLimitChange={(l) => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("a_limit", String(l));
            next.delete("a_page");
            return next;
          });
        }}
      />
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <main className="px-4 py-4 md:px-8 md:py-6">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">History</h1>
          <p className="text-xs text-slate-500 mt-0.5">Paginated browse of decisions and activity</p>
        </div>

        <DecisionHistory searchParams={searchParams} setSearchParams={setSearchParams} />
        <ActivityHistory searchParams={searchParams} setSearchParams={setSearchParams} />
      </div>
    </main>
  );
}
