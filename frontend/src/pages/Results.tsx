import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { matchApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, StandingRow } from "../types";

type ResultDraft = {
  goals_home: number;
  goals_away: number;
  yellow_home: number;
  yellow_away: number;
};

const EMPTY_RESULT: ResultDraft = {
  goals_home: 0,
  goals_away: 0,
  yellow_home: 0,
  yellow_away: 0
};

function placementBadge(index: number) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return "";
}

export function Results() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();

  const [gender, setGender] = useState<"M" | "F">("M");
  const [groupTab, setGroupTab] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});

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

  const standingsQuery = useQuery({
    queryKey: ["standings", tid, gender],
    queryFn: () => tournamentApi.getStandings(tid, gender),
    enabled: Boolean(tid)
  });

  const setResultMutation = useMutation({
    mutationFn: ({ matchId, payload }: { matchId: string; payload: ResultDraft }) => matchApi.setResult(matchId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["standings", tid, gender] });
    }
  });

  const standingsBlocks = ((standingsQuery.data || []) as Array<{ group: string; standings: StandingRow[] }>).slice();

  const groupNames = useMemo(() => standingsBlocks.map((block) => block.group), [standingsBlocks]);

  useEffect(() => {
    if (groupNames.length === 0) {
      setGroupTab("");
      return;
    }
    if (!groupTab || (!groupNames.includes(groupTab) && groupTab !== "wildcard")) {
      setGroupTab(groupNames[0]);
    }
  }, [groupNames, groupTab]);

  const selectedStandings = useMemo(() => {
    if (groupTab === "wildcard") {
      const candidates: StandingRow[] = [];
      for (const block of standingsBlocks) {
        if (block.standings.length > 1) {
          candidates.push(block.standings[1]);
        }
      }
      return candidates.sort((a, b) => {
        if (a.points !== b.points) return b.points - a.points;
        if (a.goal_diff !== b.goal_diff) return b.goal_diff - a.goal_diff;
        return b.goals_for - a.goals_for;
      });
    }
    return standingsBlocks.find((block) => block.group === groupTab)?.standings || [];
  }, [groupTab, standingsBlocks]);

  const matches = useMemo(() => {
    const all = (scheduleQuery.data || []) as Match[];
    const genderMatches = all.filter((match) => (match.gender || "").toUpperCase() === gender);
    if (!groupTab || groupTab === "wildcard") return genderMatches;
    return genderMatches.filter((match) => match.group_name === groupTab);
  }, [gender, groupTab, scheduleQuery.data]);

  useEffect(() => {
    setResultDrafts((currentDrafts) => {
      const next = { ...currentDrafts };
      for (const match of matches) {
        if (!next[match.id]) {
          next[match.id] = match.result
            ? {
                goals_home: match.result.goals_home,
                goals_away: match.result.goals_away,
                yellow_home: match.result.yellow_home,
                yellow_away: match.result.yellow_away
              }
            : { ...EMPTY_RESULT };
        }
      }
      return next;
    });
  }, [matches]);

  const updateDraft = (matchId: string, key: keyof ResultDraft, value: number) => {
    setResultDrafts((currentDrafts) => ({
      ...currentDrafts,
      [matchId]: { ...(currentDrafts[matchId] || EMPTY_RESULT), [key]: value }
    }));
  };

  const saveResult = async (matchId: string) => {
    setErrorMessage(null);
    try {
      await setResultMutation.mutateAsync({
        matchId,
        payload: resultDrafts[matchId] || EMPTY_RESULT
      });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore salvataggio risultato.");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Risultati & Classifiche</h1>
        <p className="text-sm text-slate-600">Gestione risultati inline con classifiche aggiornate in tempo reale.</p>
      </header>

      {errorMessage ? <div className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-red-700 text-sm">{errorMessage}</div> : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Torneo attivo</span>
            <select
              className="rounded-lg border px-3 py-2 min-w-64"
              value={current?.id || ""}
              onChange={(event) => {
                const selected = (tournamentsQuery.data || []).find((t: { id: string }) => t.id === event.target.value);
                if (selected) setCurrent(selected);
              }}
            >
              {(tournamentsQuery.data || []).map((tournament: { id: string; name: string }) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name}
                </option>
              ))}
            </select>
          </label>

          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              type="button"
              className={`px-4 py-2 text-sm ${gender === "M" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
              onClick={() => setGender("M")}
            >
              Maschile
            </button>
            <button
              type="button"
              className={`px-4 py-2 text-sm ${gender === "F" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
              onClick={() => setGender("F")}
            >
              Femminile
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {groupNames.map((groupName) => (
            <button
              key={groupName}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                groupTab === groupName ? "bg-slate-900 text-white border-slate-900" : ""
              }`}
              onClick={() => setGroupTab(groupName)}
            >
              {groupName}
            </button>
          ))}
          <button
            type="button"
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              groupTab === "wildcard" ? "bg-slate-900 text-white border-slate-900" : ""
            }`}
            onClick={() => setGroupTab("wildcard")}
          >
            Wild Card
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">{groupTab === "wildcard" ? "Classifica Wild Card" : `Classifica ${groupTab || ""}`}</h2>
        {selectedStandings.length === 0 ? (
          <div className="text-sm text-slate-500">Nessuna classifica disponibile.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left px-2 py-1">#</th>
                  <th className="text-left px-2 py-1">Squadra</th>
                  <th className="text-left px-2 py-1">G</th>
                  <th className="text-left px-2 py-1">V</th>
                  <th className="text-left px-2 py-1">P</th>
                  <th className="text-left px-2 py-1">S</th>
                  <th className="text-left px-2 py-1">GF</th>
                  <th className="text-left px-2 py-1">GS</th>
                  <th className="text-left px-2 py-1">DR</th>
                  <th className="text-left px-2 py-1">Pt</th>
                </tr>
              </thead>
              <tbody>
                {selectedStandings.map((row, index) => (
                  <tr key={`${row.team}-${index}`} className="border-t">
                    <td className="px-2 py-1">{index + 1}</td>
                    <td className="px-2 py-1 font-medium">
                      {row.team_name} {placementBadge(index)}
                    </td>
                    <td className="px-2 py-1">{row.played}</td>
                    <td className="px-2 py-1">{row.won}</td>
                    <td className="px-2 py-1">{row.drawn}</td>
                    <td className="px-2 py-1">{row.lost}</td>
                    <td className="px-2 py-1">{row.goals_for}</td>
                    <td className="px-2 py-1">{row.goals_against}</td>
                    <td className="px-2 py-1">{row.goal_diff}</td>
                    <td className="px-2 py-1 font-semibold">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">Match del girone (inserimento risultati inline)</h2>
        {matches.length === 0 ? (
          <div className="text-sm text-slate-500">Nessuna partita disponibile per questo filtro.</div>
        ) : (
          <div className="space-y-2">
            {matches.map((match) => {
              const draft = resultDrafts[match.id] || EMPTY_RESULT;
              return (
                <div key={match.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {match.team_home} vs {match.team_away}
                    </div>
                    <div className="text-xs text-slate-500">
                      {match.slot ? `${match.slot.day_label} ${match.slot.start_time}` : "Da schedulare"}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="number"
                      min={0}
                      className="rounded border px-2 py-1 w-16"
                      value={draft.goals_home}
                      onChange={(event) => updateDraft(match.id, "goals_home", Number(event.target.value))}
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min={0}
                      className="rounded border px-2 py-1 w-16"
                      value={draft.goals_away}
                      onChange={(event) => updateDraft(match.id, "goals_away", Number(event.target.value))}
                    />

                    <span className="ml-2 text-xs text-slate-500">Gialli</span>
                    <input
                      type="number"
                      min={0}
                      className="rounded border px-2 py-1 w-14"
                      value={draft.yellow_home}
                      onChange={(event) => updateDraft(match.id, "yellow_home", Number(event.target.value))}
                    />
                    <input
                      type="number"
                      min={0}
                      className="rounded border px-2 py-1 w-14"
                      value={draft.yellow_away}
                      onChange={(event) => updateDraft(match.id, "yellow_away", Number(event.target.value))}
                    />

                    <button
                      type="button"
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => void saveResult(match.id)}
                      disabled={setResultMutation.isPending}
                    >
                      {setResultMutation.isPending ? "Salvataggio..." : "Salva"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
