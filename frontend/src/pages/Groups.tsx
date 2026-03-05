import { useEffect, useMemo, useState } from "react";

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { CompatibilityBlock, GroupSummary, GroupTeamSummary, Tournament } from "../types";
import { buildTournamentPairs, getTournamentIdForGender } from "../utils/tournamentPairs";

function heatmapStyle(value: number | undefined): React.CSSProperties {
  if (typeof value !== "number") return { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" };
  if (value < 55) return { background: "rgba(239,68,68,0.15)", color: "#f87171" };
  if (value < 80) return { background: "rgba(245,158,11,0.15)", color: "#fbbf24" };
  return { background: "rgba(0,230,118,0.12)", color: "#00e676" };
}

function TeamChip({ team, disabled }: { team: GroupTeamSummary; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `team:${team.id}`,
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 select-none ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "ring-2 ring-offset-1 ring-offset-transparent" : ""}`}
      style={{
        ...(transform
          ? {
              transform: CSS.Translate.toString(transform),
              opacity: isDragging ? 0.5 : 1,
              zIndex: isDragging ? 999 : undefined
            }
          : undefined),
        background: isDragging ? "rgba(0,230,118,0.2)" : "rgba(255,255,255,0.06)",
        border: isDragging ? "1px solid rgba(0,230,118,0.5)" : "1px solid rgba(255,255,255,0.1)",
        color: isDragging ? "#00e676" : "rgba(255,255,255,0.85)",
        boxShadow: isDragging ? "0 4px 16px rgba(0,230,118,0.2)" : undefined
      }}
    >
      {team.name}
    </div>
  );
}

function GroupDropZone({
  group,
  disabled
}: {
  group: GroupSummary;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.id}` });

  return (
    <article
      ref={setNodeRef}
      className="rounded-xl p-4 space-y-3 transition-all duration-200"
      style={{
        background: isOver ? "rgba(0,230,118,0.07)" : "rgba(255,255,255,0.03)",
        border: isOver ? "1px solid rgba(0,230,118,0.4)" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: isOver ? "0 0 20px rgba(0,230,118,0.1)" : undefined
      }}
    >
      <div className="flex items-center justify-between">
        <h3
          className="font-bold text-base"
          style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "0.04em", color: isOver ? "#00e676" : "rgba(255,255,255,0.9)" }}
        >
          {group.name}
        </h3>
        <span
          className="rounded-lg px-2 py-0.5 text-xs font-semibold"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {group.teams.length} sq.
        </span>
      </div>

      <div className="space-y-1.5 min-h-20">
        {group.teams.map((team) => (
          <TeamChip key={team.id} team={team} disabled={disabled} />
        ))}
        {group.teams.length === 0 && (
          <div
            className="rounded-lg py-4 text-center text-xs"
            style={{ color: "rgba(255,255,255,0.2)", border: "1px dashed rgba(255,255,255,0.1)" }}
          >
            {disabled ? "Nessuna squadra" : "Trascina qui"}
          </div>
        )}
      </div>
    </article>
  );
}

function CompatibilityTable({ block }: { block: CompatibilityBlock }) {
  const teams = block.teams || [];
  if (teams.length === 0) {
    return <div className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Nessuna matrice disponibile per questo genere.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <table className="min-w-full text-xs">
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>
              SQUADRA
            </th>
            {teams.map((team) => (
              <th key={team.id} className="px-3 py-2 text-left font-semibold whitespace-nowrap" style={{ color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>
                {team.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((rowTeam, rowIdx) => (
            <tr key={rowTeam.id} style={{ borderTop: rowIdx > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined }}>
              <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "rgba(255,255,255,0.7)" }}>
                {rowTeam.name}
              </td>
              {teams.map((colTeam) => {
                if (rowTeam.id === colTeam.id) {
                  return (
                    <td key={colTeam.id} className="px-3 py-2 text-center" style={{ color: "rgba(255,255,255,0.15)" }}>
                      —
                    </td>
                  );
                }
                const value = block.matrix?.[rowTeam.id]?.[colTeam.id];
                return (
                  <td key={colTeam.id} className="px-3 py-2">
                    <span
                      className="rounded-lg px-2 py-0.5 font-semibold"
                      style={heatmapStyle(value)}
                    >
                      {typeof value === "number" ? `${value}%` : "—"}
                    </span>
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

function teamIdList(group: GroupSummary) {
  return group.teams.map((team) => team.id);
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function Groups() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [genderTab, setGenderTab] = useState<"M" | "F">("M");
  const [manualMode, setManualMode] = useState(false);
  const [localGroups, setLocalGroups] = useState<GroupSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });

  const tournaments = (tournamentsQuery.data || []) as Tournament[];
  const pairs = useMemo(() => buildTournamentPairs(tournaments), [tournaments]);
  const selectedPair = useMemo(() => pairs.find((pair) => pair.key === selectedPairKey) ?? null, [pairs, selectedPairKey]);

  useEffect(() => {
    if (!pairs.length) {
      if (selectedPairKey) setSelectedPairKey("");
      return;
    }
    if (selectedPairKey && pairs.some((pair) => pair.key === selectedPairKey)) return;
    const pairFromCurrent = current
      ? pairs.find((pair) => pair.male?.id === current.id || pair.female?.id === current.id)
      : null;
    setSelectedPairKey((pairFromCurrent || pairs[0]).key);
  }, [current?.id, pairs, selectedPairKey]);

  useEffect(() => {
    if (!selectedPair) return;
    const active = getTournamentIdForGender(selectedPair, genderTab);
    const fallback = active || selectedPair.male?.id || selectedPair.female?.id || "";
    const tournament = tournaments.find((item) => item.id === fallback);
    if (tournament && current?.id !== tournament.id) {
      setCurrent(tournament);
    }
  }, [current?.id, genderTab, selectedPair, setCurrent, tournaments]);

  const tid = getTournamentIdForGender(selectedPair, genderTab) || "";

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

  useEffect(() => {
    if (groupsQuery.data) {
      setLocalGroups((groupsQuery.data || []) as GroupSummary[]);
    }
  }, [groupsQuery.data]);

  const generateMutation = useMutation({
    mutationFn: () => tournamentApi.generateGroups(tid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["groups", tid] });
      await queryClient.invalidateQueries({ queryKey: ["groups-compatibility", tid] });
    }
  });

  const updateTeamsMutation = useMutation({
    mutationFn: ({ groupId, teamIds }: { groupId: string; teamIds: string[] }) =>
      tournamentApi.updateGroupTeams(tid, groupId, teamIds)
  });

  const groups = (localGroups || []).filter((group) => group.gender === genderTab);
  const originalGroups = ((groupsQuery.data || []) as GroupSummary[]).filter((group) => group.gender === genderTab);

  const compatibility = (compatibilityQuery.data || {}) as Record<string, CompatibilityBlock>;
  const compatibilityBlock = compatibility[genderTab] || { teams: [], matrix: {} };

  const hasManualChanges = useMemo(() => {
    if (!manualMode) return false;
    const byId = new Map(originalGroups.map((group) => [group.id, group]));
    return groups.some((group) => {
      const original = byId.get(group.id);
      if (!original) return true;
      return !sameIds(teamIdList(group), teamIdList(original));
    });
  }, [groups, manualMode, originalGroups]);

  const onGenerateGroups = async () => {
    if (!tid) {
      setErrorMessage(
        genderTab === "M"
          ? "Il torneo maschile non e configurato nella coppia selezionata."
          : "Il torneo femminile non e configurato nella coppia selezionata."
      );
      return;
    }
    setErrorMessage(null);
    try {
      await generateMutation.mutateAsync();
      setManualMode(false);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante generazione gironi.");
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!manualMode) return;
    const active = String(event.active.id || "");
    const over = event.over ? String(event.over.id) : "";
    if (!active.startsWith("team:") || !over.startsWith("group:")) return;

    const teamId = active.replace("team:", "");
    const targetGroupId = over.replace("group:", "");

    setLocalGroups((currentGroups) => {
      const next = currentGroups.map((group) => ({ ...group, teams: [...group.teams] }));
      const targetGroup = next.find((group) => group.id === targetGroupId && group.gender === genderTab);
      if (!targetGroup) return currentGroups;

      const sourceGroup = next.find((group) => group.gender === genderTab && group.teams.some((team) => team.id === teamId));
      if (!sourceGroup || sourceGroup.id === targetGroup.id) return currentGroups;

      const team = sourceGroup.teams.find((item) => item.id === teamId);
      if (!team) return currentGroups;

      sourceGroup.teams = sourceGroup.teams.filter((item) => item.id !== teamId);
      targetGroup.teams = [...targetGroup.teams, team];
      return next;
    });
  };

  const saveManualChanges = async () => {
    if (!tid) {
      setErrorMessage(genderTab === "M" ? "Manca il torneo maschile." : "Manca il torneo femminile.");
      return;
    }
    setErrorMessage(null);

    const originalById = new Map(originalGroups.map((group) => [group.id, group]));
    const changedGroups = groups.filter((group) => {
      const original = originalById.get(group.id);
      if (!original) return true;
      return !sameIds(teamIdList(group), teamIdList(original));
    });

    try {
      for (const group of changedGroups) {
        await updateTeamsMutation.mutateAsync({
          groupId: group.id,
          teamIds: teamIdList(group)
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["groups", tid] });
      setManualMode(false);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore nel salvataggio modifiche manuali.");
    }
  };

  const cancelManualChanges = () => {
    setManualMode(false);
    setLocalGroups((groupsQuery.data || []) as GroupSummary[]);
  };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <header>
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.95)" }}
        >
          Gironi
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Generazione automatica, modifica manuale e matrice di compatibilita oraria.
        </p>
      </header>

      {errorMessage && (
        <div className="sport-alert-error">{errorMessage}</div>
      )}

      {/* Controls */}
      <section
        className="rounded-xl p-4 space-y-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Coppia tornei M/F
            </span>
            <select
              className="sport-select min-w-56"
              value={selectedPairKey}
              onChange={(event) => {
                setSelectedPairKey(event.target.value);
                setManualMode(false);
                setErrorMessage(null);
              }}
            >
              {pairs.map((pair) => (
                <option key={pair.key} value={pair.key}>
                  {pair.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="sport-btn-secondary"
            onClick={() => void onGenerateGroups()}
            disabled={!tid || generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generazione...
              </span>
            ) : (
              "Rigenera"
            )}
          </button>

          <button
            type="button"
            className={manualMode ? "sport-btn-primary" : "sport-btn-secondary"}
            onClick={() => {
              if (manualMode) {
                cancelManualChanges();
                return;
              }
              setManualMode(true);
            }}
            disabled={!tid}
          >
            {manualMode ? "Annulla modifica" : "Modifica manuale"}
          </button>

          {manualMode && (
            <button
              type="button"
              className="sport-btn-primary"
              onClick={() => void saveManualChanges()}
              disabled={!hasManualChanges || updateTeamsMutation.isPending}
            >
              {updateTeamsMutation.isPending ? "Salvataggio..." : "Salva modifiche"}
            </button>
          )}
        </div>

        {/* Gender tabs */}
        <div className="flex gap-1">
          {(["M", "F"] as const).map((g) => {
            const isActive = genderTab === g;
            const color = g === "M" ? "#3b82f6" : "#ec4899";
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGenderTab(g)}
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
                style={{
                  background: isActive ? (g === "M" ? "rgba(59,130,246,0.15)" : "rgba(236,72,153,0.15)") : "rgba(255,255,255,0.04)",
                  color: isActive ? color : "rgba(255,255,255,0.45)",
                  border: `1px solid ${isActive ? color + "55" : "rgba(255,255,255,0.08)"}`,
                  fontFamily: "Rajdhani, sans-serif",
                  letterSpacing: "0.06em"
                }}
              >
                {g === "M" ? "Maschile" : "Femminile"}
              </button>
            );
          })}
        </div>

        {selectedPair ? (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {(["M", "F"] as const).map((g) => {
              const t = g === "M" ? selectedPair.male : selectedPair.female;
              const isActive = genderTab === g;
              const color = g === "M" ? "#60a5fa" : "#f472b6";
              const label = g === "M" ? "Maschile" : "Femminile";
              if (!t) {
                return (
                  <span key={g} className="px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    {label}: <em>non configurato</em>
                  </span>
                );
              }
              const max = t.max_teams;
              return (
                <span key={g} className="px-2.5 py-1 rounded-lg font-medium transition-all"
                  style={{
                    background: isActive ? `${color}14` : "rgba(255,255,255,0.04)",
                    color: isActive ? color : "rgba(255,255,255,0.35)",
                    border: `1px solid ${isActive ? color + "40" : "rgba(255,255,255,0.07)"}`,
                  }}>
                  {g === "M" ? "♂" : "♀"} {label}
                  {max ? <span className="ml-1.5 font-bold" style={{ opacity: 0.8 }}>· {max} squadre</span> : null}
                  {isActive && <span className="ml-1.5 font-bold" style={{ color: "#00e676" }}>← attivo</span>}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="sport-alert-warning text-xs">Nessuna edizione disponibile. Crea prima i tornei in Configurazione.</div>
        )}
      </section>

      {/* Groups grid */}
      <section
        className="rounded-xl p-4 space-y-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between">
          <h2
            className="font-bold text-sm uppercase tracking-widest"
            style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em" }}
          >
            Gironi auto-generati
          </h2>
          {manualMode && (
            <span
              className="text-xs font-semibold flex items-center gap-1.5"
              style={{ color: "#f97316" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Drag & drop attivo
            </span>
          )}
        </div>

        {groupsQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="sport-skeleton rounded-xl h-32" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-10" style={{ color: "rgba(255,255,255,0.25)" }}>
            <div className="text-4xl mb-2">⚽</div>
            <div className="text-sm">Nessun girone disponibile. Clicca Rigenera per generare i gironi.</div>
          </div>
        ) : (
          <DndContext onDragEnd={onDragEnd}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => (
                <GroupDropZone key={group.id} group={group} disabled={!manualMode} />
              ))}
            </div>
          </DndContext>
        )}
      </section>

      {/* Compatibility matrix */}
      <section
        className="rounded-xl p-4 space-y-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <h2
          className="font-bold text-sm uppercase tracking-widest"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em" }}
        >
          Matrice Compatibilita Oraria
        </h2>
        <CompatibilityTable block={compatibilityBlock} />
      </section>
    </div>
  );
}
