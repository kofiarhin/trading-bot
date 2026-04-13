import { NavLink, Outlet } from "react-router-dom";

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard", mobileLabel: "Home" },
  { to: "/journal", label: "Trade Journal", mobileLabel: "Journal" },
  { to: "/history", label: "History", mobileLabel: "History" },
];

const linkClass = (isActive) =>
  `rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-slate-700 text-white"
      : "text-slate-400 hover:text-white hover:bg-slate-800"
  }`;

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-screen-2xl items-center justify-between px-4 md:px-8">
          <span className="text-sm font-bold tracking-tight text-white">Trading Bot</span>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `px-3 py-1.5 ${linkClass(isActive)}`}
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <main className="pb-20 md:pb-0">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-900/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm md:hidden">
        <div className="mx-auto grid max-w-screen-sm grid-cols-3 gap-2">
          {NAV_LINKS.map(({ to, mobileLabel }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex h-10 items-center justify-center ${linkClass(isActive)}`
              }
            >
              {mobileLabel}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
