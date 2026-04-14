import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJournalSummary, useJournalTrades } from "../hooks/queries/useJournal.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtUsd(n) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function pnlColor(n) {
  if (n == null) return "text-slate-400";
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-400";
}

// ─── Summary Cards ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, valueClass, sub }) {
  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${valueClass ?? "text-white"}`}>{value ?? "—"}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

function JournalSummaryCards() {
  const { data: s, isLoading } = useJournalSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-slate-800 border border-slate-700 px-5 py-4 h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  const totalPnlColor = s?.totalPnl > 0 ? "text-emerald-400" : s?.totalPnl < 0 ? "text-red-400" : "text-white";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      <SummaryCard label="Total Trades" value={s?.totalTrades ?? "—"} />
      <SummaryCard
        label="Journal Open"
        value={s?.journalOpenTrades ?? "—"}
        valueClass="text-sky-400"
      />
      <SummaryCard
        label="Live Positions"
        value={s?.liveOpenPositions ?? "—"}
        valueClass="text-violet-400"
        sub="broker-synced"
      />
      <SummaryCard label="Closed" value={s?.closedTrades ?? "—"} />
      <SummaryCard
        label="Win Rate"
        value={s?.winRate != null ? `${s.winRate}%` : "—"}
        valueClass={s?.winRate >= 50 ? "text-emerald-400" : "text-red-400"}
        sub={s ? `${s.wins}W / ${s.losses}L` : undefined}
      />
      <SummaryCard
        label="Total PnL"
        value={s?.totalPnl != null ? fmtUsd(s.totalPnl) : "—"}
        valueClass={totalPnlColor}
      />
      <SummaryCard
        label="Avg Win / Loss"
        value={s?.avgWin != null ? fmtUsd(s.avgWin) : "—"}
        valueClass="text-emerald-400"
        sub={s?.avgLoss != null ? `Avg loss: ${fmtUsd(s.avgLoss)}` : undefined}
      />
    </div>
  );
}

// ─── Filters ────────────────────────────────────────────────────────────────

function FiltersBar({ filters, onChange }) {
  function set(key, value) {
    onChange({ ...filters, [key]: value || undefined, page: 1 });
  }

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* Symbol search */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Symbol</label>
        <input
          type="text"
          placeholder="e.g. AAPL"
          value={filters.symbol ?? ""}
          onChange={(e) => set("symbol", e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 w-32"
        />
      </div>

      {/* Asset class */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Asset Class</label>
        <select
          value={filters.assetClass ?? ""}
          onChange={(e) => set("assetClass", e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
        >
          <option value="">All</option>
          <option value="stock">Stock</option>
          <option value="crypto">Crypto</option>
        </select>
      </div>

      {/* Strategy */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Strategy</label>
        <input
          type="text"
          placeholder="e.g. breakout"
          value={filters.strategy ?? ""}
          onChange={(e) => set("strategy", e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 w-32"
        />
      </div>

      {/* Date from */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">From</label>
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(e) => set("dateFrom", e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">To</label>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(e) => set("dateTo", e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
        />
      </div>

      {/* Clear */}
      {Object.values(filters).some(Boolean) && (
        <button
          onClick={() => onChange({ page: 1 })}
          className="px-3 py-1.5 rounded-lg text-sm text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-white transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];

function Tabs({ active, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit border border-slate-700">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            active === t.key
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Trade Table ─────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: "symbol", label: "Symbol" },
  { key: "assetClassLabel", label: "Asset" },
  { key: "strategyName", label: "Strategy" },
  { key: "status", label: "Status" },
  { key: "entryPrice", label: "Entry" },
  { key: "exitPrice", label: "Exit" },
  { key: "quantity", label: "Qty" },
  { key: "pnl", label: "PnL" },
  { key: "pnlPct", label: "PnL %" },
  { key: "openedAt", label: "Opened" },
];

function StatusBadge({ status }) {
  const styles = {
    open: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    closed: "bg-slate-600/40 text-slate-300 border-slate-600",
    canceled: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-medium ${styles[status] ?? styles.closed}`}>
      {status}
    </span>
  );
}

function TradeTable({ trades, sortKey, sortDir, onSort, onRowClick }) {
  function ColHeader({ col }) {
    const isActive = sortKey === col.key;
    return (
      <th
        onClick={() => onSort(col.key)}
        className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white select-none whitespace-nowrap"
      >
        {col.label}
        {isActive && (
          <span className="ml-1 text-slate-500">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-800/80 border-b border-slate-700">
          <tr>
            {COLUMNS.map((col) => (
              <ColHeader key={col.key} col={col} />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {trades.map((t) => (
            <tr
              key={t.tradeId}
              onClick={() => onRowClick(t.tradeId)}
              className="hover:bg-slate-700/30 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-mono font-semibold text-white whitespace-nowrap">
                {t.symbol}
              </td>
              <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                {t.assetClassLabel ?? t.assetClass ?? "—"}
              </td>
              <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                {t.strategyName ?? "—"}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                {t.entryPrice != null ? `$${t.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
              </td>
              <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                {t.exitPrice != null ? `$${t.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
              </td>
              <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                {t.quantity ?? "—"}
              </td>
              <td className={`px-4 py-3 font-mono whitespace-nowrap ${pnlColor(t.pnl)}`}>
                {t.pnl != null ? fmtUsd(t.pnl) : "—"}
              </td>
              <td className={`px-4 py-3 font-mono whitespace-nowrap ${pnlColor(t.pnlPct)}`}>
                {t.pnlPct != null ? fmtPct(t.pnlPct) : "—"}
              </td>
              <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                {fmtDate(t.openedAt ?? t.pendingAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function Pagination({ page, pages, total, limit, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-slate-400">
      <span>
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} trades
      </span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Prev
        </button>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState({ page: 1 });
  const [sortKey, setSortKey] = useState("openedAt");
  const [sortDir, setSortDir] = useState("desc");

  const queryFilters = {
    ...filters,
    status: tab !== "all" ? tab : undefined,
    limit: 50,
  };

  const { data, isLoading, isError, error } = useJournalTrades(queryFilters);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedTrades = [...(data?.trades ?? [])].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <main className="px-4 py-6 md:px-8">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Trade Journal</h1>
          <p className="text-xs text-slate-500 mt-0.5">Historical trade analysis</p>
        </div>

        {/* Summary cards */}
        <JournalSummaryCards />

        {/* Filters + Tabs */}
        <div className="rounded-xl bg-slate-800 border border-slate-700 p-5 space-y-4">
          <FiltersBar filters={filters} onChange={setFilters} />
          <Tabs active={tab} onChange={(t) => { setTab(t); setFilters((f) => ({ ...f, page: 1 })); }} />
        </div>

        {/* Table */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="rounded-xl bg-slate-800 border border-slate-700 p-8 text-center text-slate-500">
              Loading trades…
            </div>
          ) : isError ? (
            <div className="rounded-xl bg-slate-800 border border-slate-700 p-8 text-center text-red-400">
              Failed to load trades: {error?.message}
            </div>
          ) : sortedTrades.length === 0 ? (
            <div className="rounded-xl bg-slate-800 border border-slate-700 p-8 text-center text-slate-500">
              No trades found.
            </div>
          ) : (
            <>
              <TradeTable
                trades={sortedTrades}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                onRowClick={(id) => navigate(`/journal/${id}`)}
              />
              <Pagination
                page={data?.page ?? 1}
                pages={data?.pages ?? 1}
                total={data?.total ?? 0}
                limit={50}
                onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
