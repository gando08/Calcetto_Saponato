import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { CompatibilityBlock, GroupSummary } from "../types";

function GenderBadge({ gender }: { gender: string }) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded ${gender === "M" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}`}>
      {gender === "M" ? "Maschile" : "Femminile"}
    </span>
  );
}

function CompatibilityTable({ title, block }: { title: string; block: CompatibilityBlock }) {
  const teams = block.teams || [];
  if (teams.length === 0) {
    return (
      <div className="border rounded p-3">
        <div className="font-medium mb-1">{title}</div>
        <div className="text-sm text-slate-500">Nessuna squadra disponibile.</div>
      </div>
    );
  }

  return (
    <div className="border rounded p-3 overflow-x-auto">
      <div className="font-medium mb-2">{title}</div>
      <table className="min-w-full text-xs">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-2 py-1 text-left">Squadra</th>
            {teams.map((team) => (
              <th key={team.id} className="px-2 py-1 text-left whitespace-nowrap">
                {team.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((rowTeam) => (
            <tr key={rowTeam.id} className="border-t">
              <td className="px-2 py-1 font-medium">{rowTeam.name}</td>
              {teams.map((colTeam) => {
                if (rowTeam.id === colTeam.id) {
                  return (
                    <td key={colTeam.id} className="px-2 py-1 text-slate-400">
                      —
                    </td>
                  );
                }
                const value = block.matrix?.[rowTeam.id]?.[colTeam.id];
                return (
                  <td key={colTeam.id} className="px-2 py-1">
                    {typeof value === "number" ? `${value}%` : "-"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Groups() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [genderFilter, setGenderFilter] = useState<"ALL" | "M" | "F">("ALL");
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

  const groupsQuery = useQuery({
    queryKey: ["groups", tid],
    queryFn: () => tournamentApi.getGroups(tid),
    enabled: Boolean(tid)
  });

  const compatibilityQuery = useQuery({
    queryKey: ["groups-compatibility", tid],
    queryFn: () => tournamentApi.getGroupsCompatibility(tid),
    enabled: Boolean(tid)
  });

  const generateMutation = useMutation({
    mutationFn: () => tournamentApi.generateGroups(tid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["groups", tid] });
      await queryClient.invalidateQueries({ queryKey: ["groups-compatibility", tid] });
    }
  });

  const groups = useMemo(() => {
    const all = (groupsQuery.data || []) as GroupSummary[];
    if (genderFilter === "ALL") return all;
    return all.filter((group) => group.gender === genderFilter);
  }, [groupsQuery.data, genderFilter]);

  const compatibility = (compatibilityQuery.data || {}) as Record<string, CompatibilityBlock>;

  const onGenerateGroups = async () => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    try {
      await generateMutation.mutateAsync();
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore durante la generazione dei gironi.");
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Gironi</h1>
          <p className="text-slate-600">Generazione automatica gironi e round-robin, con matrice compatibilità oraria.</p>
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
          <span className="text-sm">Filtro genere</span>
          <select
            className="border rounded px-3 py-2"
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value as "ALL" | "M" | "F")}
          >
            <option value="ALL">Tutti</option>
            <option value="M">Maschile</option>
            <option value="F">Femminile</option>
          </select>
        </label>

        <button
          className="px-3 py-2 border rounded"
          type="button"
          onClick={() => void onGenerateGroups()}
          disabled={!tid || generateMutation.isPending}
        >
          {generateMutation.isPending ? "Generazione..." : "Genera Gironi"}
        </button>

        <button
          className="px-3 py-2 border rounded"
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["groups", tid] });
            void queryClient.invalidateQueries({ queryKey: ["groups-compatibility", tid] });
          }}
          disabled={!tid}
        >
          Refresh
        </button>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Composizione gironi</h2>
        {groupsQuery.isLoading ? (
          <div className="text-sm text-slate-500">Caricamento gironi...</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-slate-500">Nessun girone disponibile. Genera i gironi per iniziare.</div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-3">
            {groups.map((group) => (
              <div key={group.id} className="border rounded p-3 space-y-3 bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{group.name}</div>
                  <GenderBadge gender={group.gender} />
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Squadre</div>
                  <div className="flex flex-wrap gap-2">
                    {group.teams.map((team) => (
                      <span key={team.id} className="px-2 py-1 rounded border bg-white text-sm">
                        {team.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Partite Round-Robin</div>
                  <div className="space-y-1">
                    {group.matches.map((match) => (
                      <div key={match.id} className="text-sm bg-white border rounded px-2 py-1">
                        {match.team_home} vs {match.team_away}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Compatibilità disponibilità</h2>
        <div className="grid xl:grid-cols-2 gap-3">
          {genderFilter !== "F" ? (
            <CompatibilityTable title="Maschile" block={compatibility.M || { teams: [], matrix: {} }} />
          ) : null}
          {genderFilter !== "M" ? (
            <CompatibilityTable title="Femminile" block={compatibility.F || { teams: [], matrix: {} }} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
