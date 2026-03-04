import { Link, useLocation } from "react-router-dom";

const NAV = [
  {
    to: "/",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: "/setup",
    label: "Configurazione",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    to: "/teams",
    label: "Squadre",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: "/groups",
    label: "Gironi",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
  {
    to: "/schedule",
    label: "Calendario",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    to: "/results",
    label: "Risultati",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    to: "/bracket",
    label: "Bracket Finali",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path d="M8 6H5a2 2 0 0 0-2 2v3M8 18H5a2 2 0 0 1-2-2v-3M16 6h3a2 2 0 0 1 2 2v3M16 18h3a2 2 0 0 0 2-2v-3M12 12h.01" />
        <line x1="12" y1="6" x2="12" y2="9" />
        <line x1="12" y1="15" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    to: "/export",
    label: "Export",
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col w-64 min-h-screen flex-shrink-0"
        style={{
          background: "linear-gradient(180deg, #0d1224 0%, #080c18 100%)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Logo */}
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #00e676, #00c853)",
                boxShadow: "0 0 16px rgba(0,230,118,0.4)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#080c18" strokeWidth={2.5}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                <path d="M8.5 8.5L12 12l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 12v4" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div
                className="text-base font-bold leading-tight"
                style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "0.02em" }}
              >
                Calcetto
              </div>
              <div
                className="text-xs font-semibold leading-tight"
                style={{ color: "#00e676", letterSpacing: "0.06em" }}
              >
                SAPONATO
              </div>
            </div>
          </div>
        </div>

        {/* Nav label */}
        <div className="px-5 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.25)" }}>
            Navigazione
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map(({ to, label, icon }) => {
            const isActive = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative"
                style={
                  isActive
                    ? {
                        background: "rgba(0,230,118,0.1)",
                        color: "#00e676",
                        borderLeft: "2px solid #00e676",
                        paddingLeft: "10px",
                      }
                    : {
                        color: "rgba(255,255,255,0.5)",
                        borderLeft: "2px solid transparent",
                      }
                }
              >
                <span
                  className="transition-colors duration-200"
                  style={isActive ? { color: "#00e676" } : { color: "rgba(255,255,255,0.35)" }}
                >
                  {icon}
                </span>
                <span className="truncate">{label}</span>
                {isActive && (
                  <span
                    className="absolute right-3 w-1.5 h-1.5 rounded-full"
                    style={{ background: "#00e676", boxShadow: "0 0 6px #00e676" }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-5">
          <div
            className="rounded-xl p-3 text-xs"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full animate-live-dot"
                style={{ background: "#00e676", boxShadow: "0 0 6px #00e676" }}
              />
              <span style={{ color: "#00e676", fontWeight: 600 }}>Sistema attivo</span>
            </div>
            <div style={{ color: "rgba(255,255,255,0.3)" }}>Torneo in corso</div>
          </div>
        </div>
      </aside>

      {/* Mobile top nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2"
        style={{
          background: "rgba(13,18,36,0.97)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
        }}
      >
        {NAV.slice(0, 6).map(({ to, icon, label }) => {
          const isActive = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-all duration-200"
              style={isActive ? { color: "#00e676" } : { color: "rgba(255,255,255,0.4)" }}
            >
              {icon}
              <span className="text-[9px] font-semibold truncate max-w-[48px] text-center">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
