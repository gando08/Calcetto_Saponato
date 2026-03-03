import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { teamApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { GroupSummary, Match, Scorer, Team } from "../types";

function normalizeStatus(status: string) {
  const lowered = status.toLowerCase();
  if (lowered.includes("played")) return "played";
  if (lowered.includes("scheduled")) return "scheduled";
  return "pending";
}

function KpiCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div className="bg-white border rounded p-4 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {subtitle ? <div className="text-xs text-slate-500 mt-1">{subtitle}</div> : null}
    </div>
  );
}

export function Dashboard() {
  const { current, setCurrent } = useTournamentStore();

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

  const teamsQuery = useQuery({
    queryKey: ["teams", tid],
    queryFn: () => teamApi.list(tid),
    enabled: Boolean(tid)
  });
  const groupsQuery = useQuery({
    queryKey: ["groups", tid],
    queryFn: () => tournamentApi.getGroups(tid),
    enabled: Boolean(tid)
  });
  const scheduleQuery = useQuery({
    queryKey: ["schedule", tid],
    queryFn: () => tournamentApi.getSchedule(tid),
    enabled: Boolean(tid)
  });
  const scorersMQuery = useQuery({
    queryKey: ["scorers", tid, "M"],
    queryFn: () => tournamentApi.getScorers(tid, "M"),
    enabled: Boolean(tid)
  });
  const scorersFQuery = useQuery({
    queryKey: ["scorers", tid, "F"],
    queryFn: () => tournamentApi.getScorers(tid, "F"),
    enabled: Boolean(tid)
  });

  const teams = (teamsQuery.data || []) as Team[];
  const groups = (groupsQuery.data || []) as GroupSummary[];
  const matches = (scheduleQuery.data || []) as Match[];
  const scorersM = ((scorersMQuery.data || []) as Scorer[]).slice(0, 5);
  const scorersF = ((scorersFQuery.data || []) as Scorer[]).slice(0, 5);

  const metrics = useMemo(() => {
    const maleTeams = teams.filter((team) => team.gender === "M").length;
    const femaleTeams = teams.filter((team) => team.gender === "F").length;
    const maleGroups = groups.filter((group) => group.gender === "M").length;
    const femaleGroups = groups.filter((group) => group.gender === "F").length;

    let pendingMatches = 0;
    let scheduledMatches = 0;
    let playedMatches = 0;
    let assignedMatches = 0;

    for (const match of matches) {
      const status = normalizeStatus(match.status);
      if (status === "played") playedMatches += 1;
      else if (status === "scheduled") scheduledMatches += 1;
      else pendingMatches += 1;
      if (match.slot) assignedMatches += 1;
    }

    return {
      maleTeams,
      femaleTeams,
      maleGroups,
      femaleGroups,
      pendingMatches,
      scheduledMatches,
      playedMatches,
      assignedMatches
    };
  }, [teams, groups, matches]);

  const upcomingMatches = useMemo(
    () =>
      matches
        .filter((match) => Boolean(match.slot))
        .slice()
        .sort((a, b) => {
          const ad = a.slot?.day_label || "";
          const bd = b.slot?.day_label || "";
          if (ad !== bd) return ad.localeCompare(bd);
          return (a.slot?.start_time || "").localeCompare(b.slot?.start_time || "");
        })
        .slice(0, 8),
    [matches]
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Dashboard Operativa</h1>
        <p className="text-slate-600">Panoramica torneo: stato configurazione, avanzamento calendario e ranking marcatori.</p>
      </header>

      <section className="bg-white p-4 rounded shadow flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Torneo attivo</span>
          <select
            className="border rounded px-3 py-2 min-w-64"
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
        <div className="bg-white p-4 rounded shadow text-sm text-slate-500">Crea o seleziona un torneo per visualizzare la dashboard.</div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Squadre Totali" value={teams.length} subtitle={`M ${metrics.maleTeams} • F ${metrics.femaleTeams}`} />
            <KpiCard title="Gironi" value={groups.length} subtitle={`M ${metrics.maleGroups} • F ${metrics.femaleGroups}`} />
            <KpiCard
              title="Partite"
              value={matches.length}
              subtitle={`Pending ${metrics.pendingMatches} • Scheduled ${metrics.scheduledMatches} • Played ${metrics.playedMatches}`}
            />
            <KpiCard
              title="Assegnazione Slot"
              value={`${metrics.assignedMatches}/${matches.length || 0}`}
              subtitle="partite con slot associato"
            />
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-semibold mb-2">Top Marcatori Maschile</h2>
              {scorersM.length === 0 ? (
                <div className="text-sm text-slate-500">Nessun marcatore registrato.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="text-left px-2 py-1">Giocatore</th>
                      <th className="text-left px-2 py-1">Squadra</th>
                      <th className="text-left px-2 py-1">Gol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scorersM.map((row, idx) => (
                      <tr key={`${row.player}-${idx}`} className="border-t">
                        <td className="px-2 py-1">{row.player}</td>
                        <td className="px-2 py-1">{row.team}</td>
                        <td className="px-2 py-1 font-semibold">{row.goals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-semibold mb-2">Top Marcatori Femminile</h2>
              {scorersF.length === 0 ? (
                <div className="text-sm text-slate-500">Nessun marcatore registrato.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="text-left px-2 py-1">Giocatore</th>
                      <th className="text-left px-2 py-1">Squadra</th>
                      <th className="text-left px-2 py-1">Gol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scorersF.map((row, idx) => (
                      <tr key={`${row.player}-${idx}`} className="border-t">
                        <td className="px-2 py-1">{row.player}</td>
                        <td className="px-2 py-1">{row.team}</td>
                        <td className="px-2 py-1 font-semibold">{row.goals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-2">Prossime Partite Schedulate</h2>
            {upcomingMatches.length === 0 ? (
              <div className="text-sm text-slate-500">Nessuna partita con slot assegnato.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left px-2 py-1">Giorno</th>
                    <th className="text-left px-2 py-1">Orario</th>
                    <th className="text-left px-2 py-1">Match</th>
                    <th className="text-left px-2 py-1">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingMatches.map((match) => (
                    <tr key={match.id} className="border-t">
                      <td className="px-2 py-1">{match.slot?.day_label || "-"}</td>
                      <td className="px-2 py-1">
                        {match.slot ? `${match.slot.start_time} - ${match.slot.end_time}` : "-"}
                      </td>
                      <td className="px-2 py-1">
                        {match.team_home} vs {match.team_away}
                      </td>
                      <td className="px-2 py-1">{normalizeStatus(match.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
