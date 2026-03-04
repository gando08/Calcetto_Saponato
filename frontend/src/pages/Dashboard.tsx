import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, ScheduleQuality } from "../types";

function getWsUrl(tournamentId: string) {
  const apiBase = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  const wsBase = apiBase.startsWith("https://") ? apiBase.replace("https://", "wss://") : apiBase.replace("http://", "ws://");
  return `${wsBase}/api/tournaments/ws/${tournamentId}/solver`;
}

function normalizeStatus(status: string) {
  const lowered = status.toLowerCase();
  if (lowered.includes("played")) return "played";
  if (lowered.includes("scheduled")) return "scheduled";
  return "pending";
}

function parseMinutes(time: string) {
  const [h, m] = time.split(":").map((v) => Number(v));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function statusProgress(status: string) {
  if (status === "running") return 62;
  if (status === "done" || status === "optimal") return 100;
  if (status === "error" || status === "infeasible") return 100;
  return 8;
}

function levelBadge(level: "ok" | "soft" | "hard") {
  if (level === "hard") return { dot: "#ef4444", label: "Hard violation", cls: "sport-badge-red" };
  if (level === "soft") return { dot: "#f59e0b", label: "Soft violation", cls: "sport-badge-orange" };
  return { dot: "#00e676", label: "OK", cls: "sport-badge-neon" };
}

function KpiCard({
  title,
  value,
  subtitle,
  accent,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: "neon" | "blue" | "orange" | "gold";
  icon: React.ReactNode;
}) {
  const accentColor = {
    neon: "#00e676",
    blue: "#3b82f6",
    orange: "#f97316",
    gold: "#f59e0b",
  }[accent];
  const accentGlow = {
    neon: "rgba(0,230,118,0.12)",
    blue: "rgba(59,130,246,0.12)",
    orange: "rgba(249,115,22,0.12)",
    gold: "rgba(245,158,11,0.12)",
  }[accent];

  return (
    <div className="sport-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: accentGlow, border: `1px solid ${accentColor}30`, color: accentColor }}
        >
          {icon}
        </div>
        <div
          className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full"
          style={{ background: `${accentColor}15`, color: accentColor }}
        >
          KPI
        </div>
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          {title}
        </div>
        <div
          className="text-3xl font-bold tabular-nums"
          style={{ fontFamily: "Rajdhani, sans-serif", color: accentColor }}
        >
          {value}
        </div>
        <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function LiveMatchCard({ match, isLive, health }: { match: Match; isLive: boolean; health: string }) {
  const badge = levelBadge(health as "ok" | "soft" | "hard");
  const genderColor = match.gender?.toUpperCase() === "F" ? "#f472b6" : "#60a5fa";
  const genderBg = match.gender?.toUpperCase() === "F" ? "rgba(236,72,153,0.12)" : "rgba(59,130,246,0.12)";

  return (
    <div
      className={isLive ? "match-card-live" : "sport-card p-4"}
      style={{ animationDelay: "0ms" }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full animate-live-dot"
                style={{ background: "#00e676", boxShadow: "0 0 6px #00e676" }}
              />
              <span className="text-xs font-bold" style={{ color: "#00e676" }}>LIVE</span>
            </span>
          )}
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: genderBg, color: genderColor }}
          >
            {match.gender?.toUpperCase()}
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            {match.group_name || "Finali"}
          </span>
        </div>
        <span className={badge.cls} style={{ fontSize: "10px" }}>
          {badge.label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: "rgba(255,255,255,0.9)" }}>
            {match.team_home}
          </div>
        </div>
        <div
          className="flex-shrink-0 px-3 py-1 rounded-lg text-sm font-bold tabular-nums"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.9)",
            fontFamily: "Rajdhani, sans-serif",
            fontSize: "16px",
          }}
        >
          {match.result ? `${match.result.goals_home} - ${match.result.goals_away}` : "vs"}
        </div>
        <div className="flex-1 min-w-0 text-right">
          <div className="font-semibold text-sm truncate" style={{ color: "rgba(255,255,255,0.9)" }}>
            {match.team_away}
          </div>
        </div>
      </div>

      {match.slot && (
        <div className="mt-2 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          {match.slot.start_time} — {match.slot.day_label}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { current, setCurrent } = useTournamentStore();
  const [solverStatus, setSolverStatus] = useState("idle");
  const [solverObjective, setSolverObjective] = useState<number | null>(null);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });

  useEffect(() => {
    if (!current && tournamentsQuery.data?.length) {
      setCurrent(tournamentsQuery.data[0]);
    }
  }, [current, setCurrent, tournamentsQuery.data]);

  const tid = current?.id || "";

  const scheduleQuery = useQuery({
    queryKey: ["schedule", tid],
    queryFn: () => tournamentApi.getSchedule(tid),
    enabled: Boolean(tid)
  });

  const qualityQuery = useQuery({
    queryKey: ["schedule-quality", tid],
    queryFn: () => tournamentApi.getScheduleQuality(tid),
    enabled: Boolean(tid),
    refetchInterval: 8000
  });

  const scheduleStatusQuery = useQuery({
    queryKey: ["schedule-status", tid],
    queryFn: () => tournamentApi.getScheduleStatus(tid),
    enabled: Boolean(tid),
    refetchInterval: 4000
  });

  useEffect(() => {
    const status = scheduleStatusQuery.data as { status?: string; result?: { objective?: number } } | undefined;
    if (status?.status) setSolverStatus(status.status);
    if (typeof status?.result?.objective === "number") setSolverObjective(status.result.objective);
  }, [scheduleStatusQuery.data]);

  useEffect(() => {
    if (!tid) return;
    const ws = new WebSocket(getWsUrl(tid));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type?: string; status?: string; objective?: number };
        if (msg.type === "solution" && typeof msg.objective === "number") {
          setSolverObjective(msg.objective);
          setSolverStatus("running");
        }
        if (msg.type === "done" && msg.status) {
          setSolverStatus(msg.status);
        }
      } catch {
        // ignore malformed ws packets
      }
    };
    return () => ws.close();
  }, [tid]);

  const matches = ((scheduleQuery.data || []) as Match[]).slice();
  const quality = (qualityQuery.data || null) as ScheduleQuality | null;

  const statusSeries = useMemo(() => {
    const count = { pending: 0, scheduled: 0, played: 0 };
    for (const match of matches) {
      const key = normalizeStatus(match.status) as "pending" | "scheduled" | "played";
      count[key] += 1;
    }
    return [
      { name: "Da pianif.", value: count.pending, color: "rgba(255,255,255,0.2)" },
      { name: "Schedulate", value: count.scheduled, color: "#3b82f6" },
      { name: "Giocate", value: count.played, color: "#00e676" }
    ];
  }, [matches]);

  const timelineContext = useMemo(() => {
    const dated = matches.filter((match) => Boolean(match.slot?.date));
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const dates = Array.from(new Set(dated.map((match) => match.slot?.date || "").filter(Boolean))).sort();
    const targetDate = dates.includes(todayIso) ? todayIso : dates[0] || "";
    const rows = dated
      .filter((match) => (match.slot?.date || "") === targetDate)
      .sort((a, b) => (a.slot?.start_time || "").localeCompare(b.slot?.start_time || ""));

    const nowMinutes = today.getHours() * 60 + today.getMinutes();
    const withLive = rows.map((match) => {
      const start = parseMinutes(match.slot?.start_time || "00:00");
      const end = parseMinutes(match.slot?.end_time || "00:00");
      const isLive = targetDate === todayIso && nowMinutes >= start && nowMinutes < end;
      return { match, isLive };
    });

    return { targetDate, rows: withLive };
  }, [matches]);

  const progress = statusProgress(solverStatus);
  const preferencePct = quality?.preferences_respected_pct ?? 0;
  const hardViolations = quality?.hard_violations ?? 0;
  const softViolations = quality?.soft_violations ?? 0;
  const utilized = quality?.slots_utilized ?? quality?.scheduled_matches ?? 0;
  const totalSlots = quality?.total_slots ?? 0;
  const equityIndex = quality?.equity_index ?? 1;
  const alerts = quality?.alerts || [];
  const matchHealth = quality?.match_health || {};

  const totalMatches = matches.length;
  const playedMatches = matches.filter((m) => normalizeStatus(m.status) === "played").length;

  const solverColor =
    solverStatus === "running" ? "#3b82f6"
    : solverStatus === "error" || solverStatus === "infeasible" ? "#ef4444"
    : solverStatus === "done" || solverStatus === "optimal" ? "#00e676"
    : "rgba(255,255,255,0.2)";

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* Page header */}
      <header className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>
            Torneo Calcetto Saponato
          </div>
          <h1 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "0.01em" }}>
            Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
            KPI operativi · Timeline · Alert violazioni · Stato solver
          </p>
        </div>

        {/* Tournament selector */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
            Torneo attivo
          </span>
          <select
            className="sport-select min-w-52"
            value={current?.id || ""}
            onChange={(e) => {
              const selected = (tournamentsQuery.data || []).find((t: { id: string }) => t.id === e.target.value);
              if (selected) setCurrent(selected);
            }}
          >
            {(tournamentsQuery.data || []).map((t: { id: string; name: string }) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </header>

      {!tid ? (
        <div className="sport-card p-8 text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
          <div className="text-3xl mb-3">⚽</div>
          <div className="font-semibold">Nessun torneo selezionato</div>
          <div className="text-sm mt-1">Crea o seleziona un torneo per caricare la dashboard.</div>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Preferenze rispettate"
              value={`${preferencePct}%`}
              subtitle={`${quality?.preference_respected ?? 0} / ${quality?.preference_checks ?? 0} check`}
              accent="neon"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              }
            />
            <KpiCard
              title="Violazioni hard / soft"
              value={`${hardViolations} / ${softViolations}`}
              subtitle="constraint violations"
              accent={hardViolations > 0 ? "orange" : "neon"}
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              }
            />
            <KpiCard
              title="Slot utilizzati"
              value={`${utilized} / ${totalSlots}`}
              subtitle={`${quality?.coverage_pct ?? 0}% copertura calendario`}
              accent="blue"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
            />
            <KpiCard
              title="Indice equità"
              value={equityIndex.toFixed(2)}
              subtitle="distribuzione partite per team"
              accent="gold"
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              }
            />
          </section>

          {/* Match progress bar */}
          {totalMatches > 0 && (
            <section className="sport-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs uppercase tracking-widest font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Progresso torneo
                  </div>
                  <div className="text-lg font-bold" style={{ fontFamily: "Rajdhani, sans-serif" }}>
                    {playedMatches} <span style={{ color: "rgba(255,255,255,0.35)" }}>/ {totalMatches} partite giocate</span>
                  </div>
                </div>
                <div
                  className="text-2xl font-bold tabular-nums"
                  style={{ fontFamily: "Rajdhani, sans-serif", color: "#00e676" }}
                >
                  {totalMatches > 0 ? Math.round((playedMatches / totalMatches) * 100) : 0}%
                </div>
              </div>
              <div className="sport-progress-track">
                <div
                  className="sport-progress-fill animate-progress"
                  style={{ width: `${totalMatches > 0 ? (playedMatches / totalMatches) * 100 : 0}%` }}
                />
              </div>
            </section>
          )}

          {/* Timeline + Chart */}
          <section className="grid gap-4 xl:grid-cols-3">
            {/* Timeline */}
            <div className="xl:col-span-2 sport-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold" style={{ fontFamily: "Rajdhani, sans-serif" }}>
                  Timeline Giornata
                </h2>
                <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                  {timelineContext.targetDate || "—"}
                </span>
              </div>

              {timelineContext.rows.length === 0 ? (
                <div className="text-sm py-6 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Nessuna partita schedulata per la giornata corrente.
                </div>
              ) : (
                <div className="space-y-2">
                  {timelineContext.rows.map(({ match, isLive }) => (
                    <LiveMatchCard
                      key={match.id}
                      match={match}
                      isLive={isLive}
                      health={matchHealth[match.id]?.level || "ok"}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Bar chart */}
            <div className="sport-card p-5">
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "Rajdhani, sans-serif" }}>
                Distribuzione Match
              </h2>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusSeries} barSize={36}>
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#1a2340",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "10px",
                        color: "#fff",
                        fontSize: "12px",
                      }}
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {statusSeries.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Alerts + Solver */}
          <section className="grid gap-4 xl:grid-cols-2">
            {/* Alerts */}
            <div className="sport-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-bold" style={{ fontFamily: "Rajdhani, sans-serif" }}>
                  Alert Violazioni
                </h2>
                {alerts.length > 0 && (
                  <span
                    className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(249,115,22,0.2)", color: "#fb923c" }}
                  >
                    {alerts.length}
                  </span>
                )}
              </div>
              {alerts.length === 0 ? (
                <div className="flex items-center gap-3 py-4">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(0,230,118,0.1)" }}
                  >
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#00e676" strokeWidth={2.5}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Nessuna violazione soft rilevata.
                  </span>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {alerts.map((alert) => (
                    <div
                      key={`${alert.match_id}-${alert.message}`}
                      className="rounded-xl p-3"
                      style={{
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.2)",
                      }}
                    >
                      <div className="text-sm font-semibold" style={{ color: "#fcd34d" }}>
                        {alert.message}
                      </div>
                      <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {alert.reasons.join(" · ")}
                      </div>
                      <a
                        className="text-xs mt-1 inline-block underline"
                        style={{ color: "#f59e0b" }}
                        href={`/schedule#match-${alert.match_id}`}
                      >
                        Vai al match →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Solver status */}
            <div className="sport-card p-5">
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "Rajdhani, sans-serif" }}>
                Stato Solver
              </h2>

              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    background: solverColor,
                    boxShadow: `0 0 8px ${solverColor}`,
                    animation: solverStatus === "running" ? "liveDot 1.4s ease-in-out infinite" : "none",
                  }}
                />
                <div>
                  <span
                    className="text-base font-bold uppercase tracking-wide"
                    style={{ fontFamily: "Rajdhani, sans-serif", color: solverColor }}
                  >
                    {solverStatus}
                  </span>
                  {solverObjective !== null && (
                    <span className="text-xs ml-2" style={{ color: "rgba(255,255,255,0.35)" }}>
                      objective: {solverObjective}
                    </span>
                  )}
                </div>
              </div>

              <div className="sport-progress-track mb-2">
                <div
                  className="rounded-full h-full transition-all duration-700 ease-out"
                  style={{
                    width: `${progress}%`,
                    background: `linear-gradient(90deg, ${solverColor}, ${solverColor}99)`,
                    animation: solverStatus === "running" ? "pulseNeon 2.5s ease-in-out infinite" : "none",
                  }}
                />
              </div>

              <div className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                {solverStatus === "running"
                  ? "Il solver sta cercando la migliore assegnazione degli slot..."
                  : solverStatus === "idle"
                    ? "Nessuna esecuzione attiva. Vai al Calendario per generare."
                    : solverStatus === "done" || solverStatus === "optimal"
                      ? "Esecuzione completata con successo."
                      : solverStatus === "error" || solverStatus === "infeasible"
                        ? "Esecuzione terminata con errore."
                        : "Stato non disponibile."}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
