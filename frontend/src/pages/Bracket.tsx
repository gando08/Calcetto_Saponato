import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { BracketMatch } from "../types";

function phaseToLabel(phase: string) {
  switch (phase) {
    case "quarter":
      return "Quarti";
    case "semi":
      return "Semifinale";
    case "final":
      return "Finale";
    case "third":
      return "Finale 3° posto";
    default:
      return phase;
  }
}

function roundToLabel(round: number) {
  if (round === 1) return "Round 1";
  if (round === 2) return "Round 2";
  if (round === 3) return "Round 3";
  return `Round ${round}`;
}

export function Bracket() {
  const { current, setCurrent } = useTournamentStore();
  const [gender, setGender] = useState<"M" | "F">("M");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<BracketMatch[]>([]);

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

  const generateMutation = useMutation({
    mutationFn: () => tournamentApi.generateBracket(tid, gender)
  });

  const bracketRounds = useMemo(() => {
    const grouped = new Map<number, BracketMatch[]>();
    for (const match of matches.filter((m) => m.phase !== "third")) {
      const list = grouped.get(match.round) || [];
      list.push(match);
      grouped.set(match.round, list);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, list]) => ({
        round,
        matches: list.sort((a, b) => a.bracket_position - b.bracket_position)
      }));
  }, [matches]);

  const thirdPlaceMatch = useMemo(() => matches.find((m) => m.phase === "third") || null, [matches]);

  const onGenerateBracket = async () => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    try {
      const data = (await generateMutation.mutateAsync()) as { matches?: BracketMatch[] };
      setMatches((data.matches || []).slice());
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore durante la generazione del bracket.");
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bracket Finali</h1>
          <p className="text-slate-600">Genera e visualizza il tabellone a eliminazione diretta per Maschile e Femminile.</p>
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

        <button
          className="px-3 py-2 border rounded"
          type="button"
          onClick={() => void onGenerateBracket()}
          disabled={!tid || generateMutation.isPending}
        >
          {generateMutation.isPending ? "Generazione..." : "Genera Bracket"}
        </button>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-4">
        <h2 className="font-semibold">Tabellone {gender === "M" ? "Maschile" : "Femminile"}</h2>

        {matches.length === 0 ? (
          <div className="text-sm text-slate-500">Nessun bracket disponibile. Clicca "Genera Bracket".</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-3">
              {bracketRounds.map((roundBlock) => (
                <div key={roundBlock.round} className="border rounded p-3 bg-slate-50">
                  <div className="font-medium mb-2">{roundToLabel(roundBlock.round)}</div>
                  <div className="space-y-2">
                    {roundBlock.matches.map((match) => (
                      <div key={`${match.round}-${match.bracket_position}-${match.phase}`} className="rounded border bg-white p-2 text-sm">
                        <div className="text-xs text-slate-500 mb-1">
                          {phaseToLabel(match.phase)} • Pos. {match.bracket_position + 1}
                        </div>
                        <div className="font-medium">{match.placeholder_home}</div>
                        <div className="text-slate-600">vs</div>
                        <div className="font-medium">{match.placeholder_away}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {thirdPlaceMatch ? (
              <div className="border rounded p-3 bg-amber-50">
                <div className="font-medium mb-1">Finale 3° posto</div>
                <div className="text-sm">
                  {thirdPlaceMatch.placeholder_home} vs {thirdPlaceMatch.placeholder_away}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
