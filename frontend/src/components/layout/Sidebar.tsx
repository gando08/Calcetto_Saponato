import { Link, useLocation } from "react-router-dom";

const NAV = [
  { to: "/", label: "📊 Dashboard" },
  { to: "/setup", label: "Configurazione" },
  { to: "/teams", label: "👥 Squadre" },
  { to: "/groups", label: "🏆 Gironi" },
  { to: "/schedule", label: "📅 Calendario" },
  { to: "/results", label: "📋 Risultati & Classifiche" },
  { to: "/bracket", label: "🏅 Bracket Finali" },
  { to: "/export", label: "📤 Export" }
];

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="w-full md:w-72 bg-[#102a43] text-white md:min-h-screen p-4 md:p-5 flex md:flex-col gap-3 border-b md:border-b-0 md:border-r border-white/10">
      <div className="w-full">
        <div className="text-xl md:text-2xl font-bold tracking-tight px-2">Calcetto Saponato</div>
      </div>
      <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1">
        {NAV.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
              pathname === to ? "bg-white text-[#102a43] font-semibold" : "text-slate-100 hover:bg-white/15"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
