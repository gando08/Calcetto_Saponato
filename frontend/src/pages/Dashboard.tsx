import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
  if (level === "hard") return { icon: "🔴", label: "hard", className: "bg-red-100 text-red-700 border-red-300" };
  if (level === "soft") return { icon: "🟡", label: "soft", className: "bg-amber-100 text-amber-700 border-amber-300" };
  return { icon: "🟢", label: "ok", className: "bg-emerald-100 text-emerald-700 border-emerald-300" };
}

function KpiCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <article className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-extrabold text-[#102a43]">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
    </article>
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
      { name: "Da pianificare", value: count.pending },
      { name: "Schedulate", value: count.scheduled },
      { name: "Giocate", value: count.played }
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

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-[#bcccdc] bg-white/80 p-5 shadow-sm">
        <h1 className="text-2xl md:text-3xl font-extrabold text-[#102a43]">Dashboard</h1>
        <p className="text-slate-600 mt-1">KPI operativi, timeline giornata, alert violazioni e stato del solver.</p>
      </header>

      <section className="rounded-2xl border border-[#bcccdc] bg-white/80 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-500">Torneo attivo</span>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 min-w-64 bg-white"
            value={current?.id || ""}
            onChange={(e) => {
              const selected = (tournamentsQuery.data || []).find((t: { id: string }) => t.id === e.target.value);
              if (selected) setCurrent(selected);
            }}
          >
            {(tournamentsQuery.data || []).map((t: { id: string; name: string }) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {!tid ? (
        <div className="rounded-xl border border-[#bcccdc] bg-white p-4 text-slate-600">Crea o seleziona un torneo per caricare la dashboard.</div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Preferenze rispettate" value={`${preferencePct}%`} subtitle={`${quality?.preference_respected ?? 0}/${quality?.preference_checks ?? 0} check`} />
            <KpiCard title="Violazioni hard/soft" value={`${hardViolations} / ${softViolations}`} subtitle="hard + soft constraints" />
            <KpiCard title="Slot utilizzati" value={`${utilized} / ${totalSlots}`} subtitle={`${quality?.coverage_pct ?? 0}% copertura calendario`} />
            <KpiCard title="Indice equita" value={equityIndex.toFixed(2)} subtitle="distribuzione partite per team" />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <article className="xl:col-span-2 rounded-2xl border border-[#bcccdc] bg-white/90 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-bold text-[#102a43]">Timeline Giorno Corrente</h2>
                <span className="text-xs text-slate-500">{timelineContext.targetDate || "Nessuna data disponibile"}</span>
              </div>
              {timelineContext.rows.length === 0 ? (
                <div className="text-sm text-slate-500">Nessuna partita schedulata per la giornata corrente.</div>
              ) : (
                <div className="space-y-2">
                  {timelineContext.rows.map(({ match, isLive }) => {
                    const health = matchHealth[match.id]?.level || "ok";
                    const badge = levelBadge(health);
                    return (
                      <div
                        key={match.id}
                        className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-3 ${
                          isLive ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div>
                          <div className="text-sm font-semibold text-[#102a43]">
                            {match.slot?.start_time} - {match.team_home} vs {match.team_away}
                          </div>
                          <div className="text-xs text-slate-500">
                            [{(match.gender || "").toUpperCase()} - {match.group_name || "Finali"}] {isLive ? "• LIVE" : ""}
                          </div>
                        </div>
                        <span className={`text-xs border rounded-full px-2 py-1 ${badge.className}`}>
                          {badge.icon} {badge.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-[#bcccdc] bg-white/90 p-4 shadow-sm">
              <h2 className="text-lg font-bold text-[#102a43] mb-3">Distribuzione Match</h2>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusSeries}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3f83f8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-[#bcccdc] bg-white/90 p-4 shadow-sm">
              <h2 className="text-lg font-bold text-[#102a43] mb-3">Alert Violazioni Soft</h2>
              {alerts.length === 0 ? (
                <div className="text-sm text-slate-500">Nessuna violazione soft rilevata.</div>
              ) : (
                <div className="space-y-2">
                  {alerts.map((alert) => (
                    <div key={`${alert.match_id}-${alert.message}`} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                      <div className="text-sm font-semibold text-amber-900">{alert.message}</div>
                      <div className="text-xs text-amber-800">{alert.reasons.join(" • ")}</div>
                      <a className="text-xs underline text-amber-900" href={`/schedule#match-${alert.match_id}`}>
                        Vai al match
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-[#bcccdc] bg-white/90 p-4 shadow-sm">
              <h2 className="text-lg font-bold text-[#102a43] mb-3">Stato Solver</h2>
              <div className="text-sm text-slate-700 mb-2">
                Stato: <strong>{solverStatus}</strong> {solverObjective !== null ? `• objective ${solverObjective}` : ""}
              </div>
              <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-3 ${solverStatus === "running" ? "bg-blue-500 animate-pulse" : solverStatus === "error" ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {solverStatus === "running"
                  ? "Il solver sta cercando la migliore assegnazione."
                  : solverStatus === "idle"
                    ? "Nessuna esecuzione attiva."
                    : "Esecuzione terminata."}
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
