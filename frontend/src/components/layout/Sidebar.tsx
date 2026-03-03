import { Link, useLocation } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/setup", label: "Configurazione" },
  { to: "/teams", label: "Squadre" },
  { to: "/groups", label: "Gironi" },
  { to: "/schedule", label: "Calendario" },
  { to: "/results", label: "Risultati e Classifiche" },
  { to: "/bracket", label: "Bracket Finali" },
  { to: "/export", label: "Export" }
];

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="w-56 bg-slate-900 text-white min-h-screen p-4 flex flex-col gap-1">
      <div className="text-xl font-bold mb-6 px-2">Calcetto Saponato</div>
      {NAV.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={`px-3 py-2 rounded-md text-sm transition-colors ${
            pathname === to ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          {label}
        </Link>
      ))}
    </aside>
  );
}
