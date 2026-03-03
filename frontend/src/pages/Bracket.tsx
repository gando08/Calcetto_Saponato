import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { BracketMatch } from "../types";

function phaseLabel(phase: string) {
  const normalized = (phase || "").toLowerCase();
  if (normalized === "quarter") return "Quarti";
  if (normalized === "semi") return "Semifinale";
  if (normalized === "final") return "Finale";
  if (normalized === "third") return "Finale 3° posto";
  return phase;
}

function roundLabel(round: number) {
  if (round <= 1) return "Round 1";
  if (round === 2) return "Round 2";
  if (round === 3) return "Round 3";
  return `Round ${round}`;
}

function groupedRounds(matches: BracketMatch[]) {
  const grouped = new Map<number, BracketMatch[]>();
  for (const match of matches.filter((item) => item.phase !== "third")) {
    const list = grouped.get(match.round) || [];
    list.push(match);
    grouped.set(match.round, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, list]) => ({
      round,
      matches: list.sort((a, b) => a.bracket_position - b.bracket_position)
    }));
}

type BracketColumnProps = {
  gender: "M" | "F";
  matches: BracketMatch[];
  loading: boolean;
  onGenerate: (gender: "M" | "F") => Promise<void>;
  onAdvance: (gender: "M" | "F", match: BracketMatch, winnerTeamId: string | null | undefined) => Promise<void>;
  generating: boolean;
  advancing: boolean;
};

function BracketColumn({
  gender,
  matches,
  loading,
  onGenerate,
  onAdvance,
  generating,
  advancing
}: BracketColumnProps) {
  const rounds = groupedRounds(matches);
  const thirdMatch = matches.find((item) => item.phase === "third") || null;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{gender === "M" ? "MASCHILE" : "FEMMINILE"}</h2>
        <button
          type="button"
          className="rounded-lg border px-3 py-1.5 text-sm"
          onClick={() => void onGenerate(gender)}
          disabled={generating}
        >
          {generating ? "Generazione..." : "Rigenera"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Caricamento bracket...</div>
      ) : matches.length === 0 ? (
        <div className="text-sm text-slate-500">Nessun bracket generato.</div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-3">
            {rounds.map((round) => (
              <div key={round.round} className="rounded-lg border bg-slate-50 p-2">
                <div className="font-medium text-sm mb-2">{roundLabel(round.round)}</div>
                <div className="space-y-2">
                  {round.matches.map((match) => (
                    <div key={match.id || `${match.round}-${match.bracket_position}`} className="rounded-lg border bg-white p-2">
                      <div className="text-xs text-slate-500 mb-1">
                        {phaseLabel(match.phase)} • {match.status || "pending"}
                      </div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          className="w-full rounded border px-2 py-1 text-left text-sm disabled:opacity-50"
                          onClick={() => void onAdvance(gender, match, match.team_home_id)}
                          disabled={!match.team_home_id || !match.id || advancing}
                        >
                          {match.placeholder_home || "TBD"}
                        </button>
                        <div className="text-center text-xs text-slate-500">vs</div>
                        <button
                          type="button"
                          className="w-full rounded border px-2 py-1 text-left text-sm disabled:opacity-50"
                          onClick={() => void onAdvance(gender, match, match.team_away_id)}
                          disabled={!match.team_away_id || !match.id || advancing}
                        >
                          {match.placeholder_away || "TBD"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {thirdMatch ? (
            <div className="rounded-lg border bg-amber-50 p-2">
              <div className="font-medium text-sm mb-1">Finale 3° posto</div>
              <div className="text-sm">
                {thirdMatch.placeholder_home} vs {thirdMatch.placeholder_away}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Bracket() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const bracketMQuery = useQuery({
    queryKey: ["bracket", tid, "M"],
    queryFn: () => tournamentApi.getBracket(tid, "M"),
    enabled: Boolean(tid)
  });

  const bracketFQuery = useQuery({
    queryKey: ["bracket", tid, "F"],
    queryFn: () => tournamentApi.getBracket(tid, "F"),
    enabled: Boolean(tid)
  });

  const generateMutation = useMutation({
    mutationFn: ({ gender }: { gender: "M" | "F" }) => tournamentApi.generateBracket(tid, gender),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["bracket", tid, vars.gender] });
    }
  });

  const advanceMutation = useMutation({
    mutationFn: ({ gender, matchId, winnerTeamId }: { gender: "M" | "F"; matchId: string; winnerTeamId: string }) =>
      tournamentApi.advanceBracket(tid, gender, matchId, winnerTeamId),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["bracket", tid, vars.gender] });
    }
  });

  const matchesM = useMemo(
    () => ((((bracketMQuery.data || {}) as { matches?: BracketMatch[] }).matches || []).slice() as BracketMatch[]),
    [bracketMQuery.data]
  );

  const matchesF = useMemo(
    () => ((((bracketFQuery.data || {}) as { matches?: BracketMatch[] }).matches || []).slice() as BracketMatch[]),
    [bracketFQuery.data]
  );

  const onGenerate = async (gender: "M" | "F") => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    try {
      await generateMutation.mutateAsync({ gender });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante generazione bracket.");
    }
  };

  const onAdvance = async (gender: "M" | "F", match: BracketMatch, winnerTeamId: string | null | undefined) => {
    if (!tid || !winnerTeamId || !match.id) return;
    setErrorMessage(null);
    try {
      await advanceMutation.mutateAsync({
        gender,
        matchId: match.id,
        winnerTeamId
      });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore avanzamento bracket.");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Bracket Finali</h1>
        <p className="text-sm text-slate-600">Tabellone finale con avanzamento squadre per Maschile e Femminile.</p>
      </header>

      {errorMessage ? <div className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-red-700 text-sm">{errorMessage}</div> : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 max-w-md">
          <span className="text-xs uppercase tracking-wide text-slate-500">Torneo attivo</span>
          <select
            className="rounded-lg border px-3 py-2"
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
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <BracketColumn
          gender="M"
          matches={matchesM}
          loading={bracketMQuery.isLoading}
          onGenerate={onGenerate}
          onAdvance={onAdvance}
          generating={generateMutation.isPending}
          advancing={advanceMutation.isPending}
        />
        <BracketColumn
          gender="F"
          matches={matchesF}
          loading={bracketFQuery.isLoading}
          onGenerate={onGenerate}
          onAdvance={onAdvance}
          generating={generateMutation.isPending}
          advancing={advanceMutation.isPending}
        />
      </section>
    </div>
  );
}
