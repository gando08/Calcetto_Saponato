import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { matchApi, teamApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, Scorer, StandingRow, Team } from "../types";

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

export function Results() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [gender, setGender] = useState<"M" | "F">("M");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});
  const [goalDraft, setGoalDraft] = useState({
    matchId: "",
    playerName: "",
    attributedTeamId: "",
    isOwnGoal: false
  });

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
  const teamsQuery = useQuery({
    queryKey: ["teams", tid],
    queryFn: () => teamApi.list(tid),
    enabled: Boolean(tid)
  });
  const standingsQuery = useQuery({
    queryKey: ["standings", tid, gender],
    queryFn: () => tournamentApi.getStandings(tid, gender),
    enabled: Boolean(tid)
  });
  const scorersQuery = useQuery({
    queryKey: ["scorers", tid, gender],
    queryFn: () => tournamentApi.getScorers(tid, gender),
    enabled: Boolean(tid)
  });

  const setResultMutation = useMutation({
    mutationFn: ({ matchId, payload }: { matchId: string; payload: ResultDraft }) => matchApi.setResult(matchId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["standings", tid, gender] });
    }
  });

  const addGoalMutation = useMutation({
    mutationFn: (payload: { mid: string; playerName: string; attributedToTeamId: string; isOwnGoal: boolean }) =>
      matchApi.addGoal(payload.mid, {
        player_name: payload.playerName,
        attributed_to_team_id: payload.attributedToTeamId,
        is_own_goal: payload.isOwnGoal
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scorers", tid, gender] });
    }
  });

  const matches = useMemo(() => {
    const all = (scheduleQuery.data || []) as Match[];
    return all.filter((m) => (m.gender || "").toUpperCase() === gender);
  }, [scheduleQuery.data, gender]);

  useEffect(() => {
    setResultDrafts((curr) => {
      const next = { ...curr };
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

  const selectedGoalMatch = matches.find((m) => m.id === goalDraft.matchId);
  const teams = (teamsQuery.data || []) as Team[];
  const allowedTeamIds = [selectedGoalMatch?.team_home_id, selectedGoalMatch?.team_away_id].filter(Boolean) as string[];
  const goalTeamOptions = teams.filter((team) => {
    if (team.gender !== gender) return false;
    if (allowedTeamIds.length === 0) return true;
    return allowedTeamIds.includes(team.id);
  });

  const updateDraft = (matchId: string, key: keyof ResultDraft, value: number) => {
    setResultDrafts((curr) => ({
      ...curr,
      [matchId]: { ...(curr[matchId] || EMPTY_RESULT), [key]: value }
    }));
  };

  const saveResult = async (matchId: string) => {
    setErrorMessage(null);
    try {
      await setResultMutation.mutateAsync({ matchId, payload: resultDrafts[matchId] || EMPTY_RESULT });
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore salvataggio risultato.");
    }
  };

  const submitGoal = async () => {
    setErrorMessage(null);
    if (!goalDraft.matchId || !goalDraft.playerName.trim() || !goalDraft.attributedTeamId) {
      setErrorMessage("Compila match, giocatore e squadra per il marcatore.");
      return;
    }
    try {
      await addGoalMutation.mutateAsync({
        mid: goalDraft.matchId,
        playerName: goalDraft.playerName.trim(),
        attributedToTeamId: goalDraft.attributedTeamId,
        isOwnGoal: goalDraft.isOwnGoal
      });
      setGoalDraft((g) => ({ ...g, playerName: "", isOwnGoal: false }));
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore inserimento marcatore.");
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Risultati, Classifiche e Marcatori</h1>
          <p className="text-slate-600">Inserisci risultati partita e aggiorna classifiche/marcatori in tempo reale.</p>
        </div>
      </header>

      {errorMessage ? <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded">{errorMessage}</div> : null}

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
        <label className="flex flex-col gap-1">
          <span className="text-sm">Genere</span>
          <select className="border rounded px-3 py-2" value={gender} onChange={(e) => setGender(e.target.value as "M" | "F")}>
            <option value="M">Maschile</option>
            <option value="F">Femminile</option>
          </select>
        </label>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Inserimento risultati</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Match</th>
                <th className="text-left px-3 py-2">Gol Casa</th>
                <th className="text-left px-3 py-2">Gol Ospite</th>
                <th className="text-left px-3 py-2">Gialli Casa</th>
                <th className="text-left px-3 py-2">Gialli Ospite</th>
                <th className="text-left px-3 py-2">Azione</th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr>
                  <td className="px-3 py-3" colSpan={6}>
                    Nessuna partita trovata per questo genere.
                  </td>
                </tr>
              ) : (
                matches.map((match) => {
                  const draft = resultDrafts[match.id] || EMPTY_RESULT;
                  return (
                    <tr key={match.id} className="border-t">
                      <td className="px-3 py-2">
                        {match.team_home} vs {match.team_away}
                        <div className="text-xs text-slate-500">
                          {match.slot ? `${match.slot.day_label} ${match.slot.start_time}` : "Non schedulata"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="border rounded px-2 py-1 w-20"
                          type="number"
                          min={0}
                          value={draft.goals_home}
                          onChange={(e) => updateDraft(match.id, "goals_home", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="border rounded px-2 py-1 w-20"
                          type="number"
                          min={0}
                          value={draft.goals_away}
                          onChange={(e) => updateDraft(match.id, "goals_away", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="border rounded px-2 py-1 w-20"
                          type="number"
                          min={0}
                          value={draft.yellow_home}
                          onChange={(e) => updateDraft(match.id, "yellow_home", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="border rounded px-2 py-1 w-20"
                          type="number"
                          min={0}
                          value={draft.yellow_away}
                          onChange={(e) => updateDraft(match.id, "yellow_away", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button className="px-3 py-1 border rounded" type="button" onClick={() => void saveResult(match.id)}>
                          Salva
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Inserimento marcatore</h2>
        <div className="grid md:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Match</span>
            <select
              className="border rounded px-3 py-2"
              value={goalDraft.matchId}
              onChange={(e) => {
                setGoalDraft((g) => ({
                  ...g,
                  matchId: e.target.value,
                  attributedTeamId: ""
                }));
              }}
            >
              <option value="">Seleziona match</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.team_home} vs {m.team_away}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm">Giocatore</span>
            <input
              className="border rounded px-3 py-2"
              value={goalDraft.playerName}
              onChange={(e) => setGoalDraft((g) => ({ ...g, playerName: e.target.value }))}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm">Squadra attribuzione</span>
            <select
              className="border rounded px-3 py-2"
              value={goalDraft.attributedTeamId}
              onChange={(e) => setGoalDraft((g) => ({ ...g, attributedTeamId: e.target.value }))}
            >
              <option value="">Seleziona squadra</option>
              {goalTeamOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2 mt-7">
            <input
              type="checkbox"
              checked={goalDraft.isOwnGoal}
              onChange={(e) => setGoalDraft((g) => ({ ...g, isOwnGoal: e.target.checked }))}
            />
            <span className="text-sm">Autogol</span>
          </div>
        </div>
        <button className="px-3 py-2 border rounded" type="button" onClick={() => void submitGoal()}>
          Aggiungi marcatore
        </button>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Classifiche</h2>
        {(standingsQuery.data || []).length === 0 ? (
          <div className="text-sm text-slate-500">Nessuna classifica disponibile.</div>
        ) : (
          ((standingsQuery.data || []) as Array<{ group: string; standings: StandingRow[] }>).map((groupBlock) => (
            <div key={groupBlock.group} className="border rounded overflow-x-auto">
              <div className="bg-slate-100 px-3 py-2 font-medium">{groupBlock.group}</div>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-2 py-1">Team</th>
                    <th className="text-left px-2 py-1">Pt</th>
                    <th className="text-left px-2 py-1">V</th>
                    <th className="text-left px-2 py-1">N</th>
                    <th className="text-left px-2 py-1">P</th>
                    <th className="text-left px-2 py-1">GF</th>
                    <th className="text-left px-2 py-1">GS</th>
                    <th className="text-left px-2 py-1">Diff</th>
                    <th className="text-left px-2 py-1">Fair Play</th>
                  </tr>
                </thead>
                <tbody>
                  {groupBlock.standings.map((row) => (
                    <tr key={row.team} className="border-t">
                      <td className="px-2 py-1">{row.team_name}</td>
                      <td className="px-2 py-1">{row.points}</td>
                      <td className="px-2 py-1">{row.won}</td>
                      <td className="px-2 py-1">{row.drawn}</td>
                      <td className="px-2 py-1">{row.lost}</td>
                      <td className="px-2 py-1">{row.goals_for}</td>
                      <td className="px-2 py-1">{row.goals_against}</td>
                      <td className="px-2 py-1">{row.goal_diff}</td>
                      <td className="px-2 py-1">{row.yellow_cards}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Marcatori</h2>
        {((scorersQuery.data || []) as Scorer[]).length === 0 ? (
          <div className="text-sm text-slate-500">Nessun marcatore registrato.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Giocatore</th>
                <th className="text-left px-3 py-2">Squadra</th>
                <th className="text-left px-3 py-2">Gol</th>
              </tr>
            </thead>
            <tbody>
              {((scorersQuery.data || []) as Scorer[]).map((s, idx) => (
                <tr key={`${s.player}-${s.team}-${idx}`} className="border-t">
                  <td className="px-3 py-2">{s.player}</td>
                  <td className="px-3 py-2">{s.team}</td>
                  <td className="px-3 py-2 font-semibold">{s.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
