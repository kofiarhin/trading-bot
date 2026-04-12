import { NavLink, Outlet } from "react-router-dom";

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/journal", label: "Trade Journal" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-4 md:px-8 h-12 flex items-center gap-1">
          <span className="text-sm font-bold text-white mr-5 tracking-tight">Trading Bot</span>
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
