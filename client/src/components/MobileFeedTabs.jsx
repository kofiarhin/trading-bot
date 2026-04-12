import { useState } from "react";
import ActivityFeed from "./ActivityFeed.jsx";
import RecentDecisionsTable from "./RecentDecisionsTable.jsx";

const TAB_STYLES = {
  active: "bg-sky-500/20 text-sky-300 border-sky-400/60",
  inactive: "bg-slate-700/40 text-slate-300 border-slate-600",
};

export default function MobileFeedTabs() {
  const [activeTab, setActiveTab] = useState("activity");

  return (
    <section className="rounded-xl bg-slate-800 border border-slate-700 overflow-hidden md:hidden">
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            className={`text-xs font-medium px-3 py-2 rounded-md border transition-colors ${
              activeTab === "activity" ? TAB_STYLES.active : TAB_STYLES.inactive
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("decisions")}
            className={`text-xs font-medium px-3 py-2 rounded-md border transition-colors ${
              activeTab === "decisions" ? TAB_STYLES.active : TAB_STYLES.inactive
            }`}
          >
            Decisions
          </button>
        </div>
      </div>

      {activeTab === "activity" ? (
        <ActivityFeed variant="mobile" previewCount={5} />
      ) : (
        <RecentDecisionsTable variant="mobile" previewCount={4} />
      )}
    </section>
  );
}
