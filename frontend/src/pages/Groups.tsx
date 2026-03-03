import { useEffect, useMemo, useState } from "react";

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { CompatibilityBlock, GroupSummary, GroupTeamSummary } from "../types";

function heatmapClass(value: number | undefined) {
  if (typeof value !== "number") return "bg-slate-100 text-slate-500";
  if (value < 55) return "bg-red-100 text-red-700";
  if (value < 80) return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function TeamChip({ team, disabled }: { team: GroupTeamSummary; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `team:${team.id}`,
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? {
              transform: CSS.Translate.toString(transform),
              opacity: isDragging ? 0.6 : 1
            }
          : undefined
      }
      {...attributes}
      {...listeners}
      className={`rounded-lg border bg-white px-2 py-1 text-sm ${disabled ? "cursor-default" : "cursor-grab"}`}
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
      className={`rounded-xl border p-3 space-y-3 ${
        isOver ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{group.name}</h3>
        <span className="rounded bg-white border px-2 py-0.5 text-xs">{group.teams.length} squadre</span>
      </div>

      <div className="space-y-2 min-h-20">
        {group.teams.map((team) => (
          <TeamChip key={team.id} team={team} disabled={disabled} />
        ))}
      </div>
    </article>
  );
}

function CompatibilityTable({ block }: { block: CompatibilityBlock }) {
  const teams = block.teams || [];
  if (teams.length === 0) {
    return <div className="text-sm text-slate-500">Nessuna matrice disponibile per questo genere.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
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
                    <span className={`rounded px-1.5 py-0.5 ${heatmapClass(value)}`}>
                      {typeof value === "number" ? `${value}%` : "-"}
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
  const [genderTab, setGenderTab] = useState<"M" | "F">("M");
  const [manualMode, setManualMode] = useState(false);
  const [localGroups, setLocalGroups] = useState<GroupSummary[]>([]);
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
      setErrorMessage("Seleziona prima un torneo.");
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
    if (!tid) return;
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
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Gironi</h1>
        <p className="text-sm text-slate-600">Generazione automatica, modifica manuale e matrice di compatibilita oraria.</p>
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

          <button
            type="button"
            className="rounded-lg border px-3 py-2"
            onClick={() => void onGenerateGroups()}
            disabled={!tid || generateMutation.isPending}
          >
            {generateMutation.isPending ? "Generazione..." : "Rigenera"}
          </button>

          <button
            type="button"
            className={`rounded-lg border px-3 py-2 ${manualMode ? "bg-slate-900 text-white border-slate-900" : ""}`}
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

          {manualMode ? (
            <button
              type="button"
              className="rounded-lg bg-slate-900 text-white px-3 py-2 disabled:opacity-50"
              onClick={() => void saveManualChanges()}
              disabled={!hasManualChanges || updateTeamsMutation.isPending}
            >
              {updateTeamsMutation.isPending ? "Salvataggio..." : "Salva modifiche"}
            </button>
          ) : null}
        </div>

        <div className="inline-flex rounded-lg border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${genderTab === "M" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
            onClick={() => setGenderTab("M")}
          >
            Maschile
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${genderTab === "F" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
            onClick={() => setGenderTab("F")}
          >
            Femminile
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Gironi auto-generati</h2>
          {manualMode ? <span className="text-xs text-slate-500">Drag & drop attivo</span> : null}
        </div>

        {groupsQuery.isLoading ? (
          <div className="text-sm text-slate-500">Caricamento gironi...</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-slate-500">Nessun girone disponibile per questo genere.</div>
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

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">Matrice compatibilita oraria</h2>
        <CompatibilityTable block={compatibilityBlock} />
      </section>
    </div>
  );
}
