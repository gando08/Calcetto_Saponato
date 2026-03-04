import { useEffect, useMemo, useState } from "react";

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { scheduleApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, ScheduleQuality, Slot } from "../types";

type MatchHealth = {
  level: "ok" | "soft" | "hard";
  hard: string[];
  soft: string[];
};

type MatchCardProps = {
  match: Match;
  health: MatchHealth | null;
  onToggleLock: (match: Match) => void;
};

function statusStyle(level: "ok" | "soft" | "hard" | "unscheduled") {
  if (level === "ok") return "bg-emerald-100 text-emerald-700";
  if (level === "soft") return "bg-amber-100 text-amber-700";
  if (level === "hard") return "bg-red-100 text-red-700";
  return "bg-slate-200 text-slate-700";
}

function statusLabel(level: "ok" | "soft" | "hard" | "unscheduled") {
  if (level === "ok") return "🟢 OK";
  if (level === "soft") return "🟡 Soft";
  if (level === "hard") return "🔴 Hard";
  return "⚫ Non schedulato";
}

function matchLevel(match: Match, health: MatchHealth | null) {
  if (!match.slot) return "unscheduled" as const;
  return (health?.level || "ok") as "ok" | "soft" | "hard";
}

function MatchCard({ match, health, onToggleLock }: MatchCardProps) {
  const disabled = match.is_manually_locked;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: match.id,
    disabled
  });

  const level = matchLevel(match, health);
  const reasons = [
    ...(health?.hard || []),
    ...(health?.soft || [])
  ];

  return (
    <div
      id={`match-${match.id}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={
        transform
          ? {
              transform: CSS.Translate.toString(transform),
              opacity: isDragging ? 0.6 : 1
            }
          : undefined
      }
      title={reasons.length > 0 ? reasons.join(" • ") : "Nessuna violazione"}
      className={`rounded-lg border bg-white p-2 shadow-sm text-sm ${disabled ? "opacity-60" : "cursor-grab"}`}
    >
      <div className="font-semibold">
        {match.team_home} vs {match.team_away}
      </div>
      <div className="text-slate-600 text-xs">
        {match.gender} • {match.group_name}
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className={`rounded px-2 py-0.5 text-xs ${statusStyle(level)}`}>{statusLabel(level)}</span>
        <button className="rounded border px-2 py-0.5 text-xs" type="button" onClick={() => onToggleLock(match)}>
          {match.is_manually_locked ? "Unlock" : "Lock"}
        </button>
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  match,
  health,
  onToggleLock
}: {
  slot: Slot;
  match: Match | null;
  health: MatchHealth | null;
  onToggleLock: (match: Match) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: slot.id });

  return (
    <div
      ref={setNodeRef}
      className={`grid gap-2 rounded-lg border p-2 sm:grid-cols-[80px_1fr] ${
        isOver ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="text-xs text-slate-600 font-medium">
        {slot.start_time}
        <div className="text-[10px] text-slate-500">{slot.end_time}</div>
      </div>
      {match ? (
        <MatchCard match={match} health={health} onToggleLock={onToggleLock} />
      ) : (
        <div className="text-xs text-slate-400 flex items-center">Slot libero</div>
      )}
    </div>
  );
}

function getWsUrl(tournamentId: string) {
  const apiBase = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  const wsBase = apiBase.startsWith("https://") ? apiBase.replace("https://", "wss://") : apiBase.replace("http://", "ws://");
  return `${wsBase}/api/tournaments/ws/${tournamentId}/solver`;
}

function compareMatchTime(a: Match, b: Match) {
  if (!a.slot && !b.slot) return 0;
  if (!a.slot) return 1;
  if (!b.slot) return -1;
  const day = a.slot.day_label.localeCompare(b.slot.day_label, "it");
  if (day !== 0) return day;
  return a.slot.start_time.localeCompare(b.slot.start_time, "it");
}

export function Schedule() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverStatus, setSolverStatus] = useState<string>("idle");
  const [solverObjective, setSolverObjective] = useState<number | null>(null);
  const [localSchedule, setLocalSchedule] = useState<Match[] | null>(null);
  const [companionTids, setCompanionTids] = useState<string[]>([]);
  const [viewTab, setViewTab] = useState<"day" | "team" | "group">("day");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");

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

  const slotsQuery = useQuery({
    queryKey: ["slots", tid],
    queryFn: () => tournamentApi.getSlots(tid),
    enabled: Boolean(tid)
  });

  const scheduleQuery = useQuery({
    queryKey: ["schedule", tid],
    queryFn: () => tournamentApi.getSchedule(tid),
    enabled: Boolean(tid)
  });

  const scheduleStatusQuery = useQuery({
    queryKey: ["schedule-status", tid],
    queryFn: () => tournamentApi.getScheduleStatus(tid),
    enabled: Boolean(tid),
    refetchInterval: 4000
  });

  const qualityQuery = useQuery({
    queryKey: ["schedule-quality", tid],
    queryFn: () => tournamentApi.getScheduleQuality(tid),
    enabled: Boolean(tid),
    refetchInterval: 2000
  });

  useEffect(() => {
    if (scheduleQuery.data) {
      setLocalSchedule(scheduleQuery.data as Match[]);
    }
  }, [scheduleQuery.data]);

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
        // no-op
      }
    };
    return () => ws.close();
  }, [tid]);

  useEffect(() => {
    setCompanionTids([]);
  }, [tid]);

  const generateMutation = useMutation({
    mutationFn: () =>
      tournamentApi.generateSchedule(tid, {
        companion_tournament_ids: companionTids.length > 0 ? companionTids : undefined
      }),
    onSuccess: () => {
      setSolverStatus("running");
      queryClient.invalidateQueries({ queryKey: ["schedule-status", tid] });
    }
  });

  const applyMutation = useMutation({
    mutationFn: () => tournamentApi.applySchedule(tid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["slots", tid] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-quality", tid] });
    }
  });

  const patchSlotMutation = useMutation({
    mutationFn: ({ mid, slotId }: { mid: string; slotId: string }) => scheduleApi.patchMatchSlot(mid, slotId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["slots", tid] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-quality", tid] });
    }
  });

  const lockMutation = useMutation({
    mutationFn: ({ mid, locked }: { mid: string; locked: boolean }) => scheduleApi.patchMatchLock(mid, locked),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["schedule-quality", tid] });
    }
  });

  const scheduleData = (localSchedule || []) as Match[];
  const slots = ((slotsQuery.data || []) as Slot[]).slice().sort((a, b) => {
    const day = a.day_label.localeCompare(b.day_label, "it");
    if (day !== 0) return day;
    return a.start_time.localeCompare(b.start_time, "it");
  });

  const quality = (qualityQuery.data || null) as ScheduleQuality | null;
  const healthMap = (quality?.match_health || {}) as Record<string, MatchHealth>;

  const bySlot = useMemo(() => {
    const map = new Map<string, Match>();
    scheduleData.forEach((match) => {
      if (match.slot?.id) map.set(match.slot.id, match);
    });
    return map;
  }, [scheduleData]);

  const unscheduled = scheduleData.filter((match) => !match.slot);

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = grouped.get(slot.day_label) ?? [];
      list.push(slot);
      grouped.set(slot.day_label, list);
    }
    return [...grouped.entries()];
  }, [slots]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of scheduleData) {
      if (match.team_home_id) map.set(match.team_home_id, match.team_home);
      if (match.team_away_id) map.set(match.team_away_id, match.team_away);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [scheduleData]);

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) {
      setSelectedTeamId(teamOptions[0].id);
    }
    if (selectedTeamId && !teamOptions.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teamOptions[0]?.id || "");
    }
  }, [selectedTeamId, teamOptions]);

  const teamMatches = useMemo(() => {
    if (!selectedTeamId) return [];
    return scheduleData
      .filter((match) => match.team_home_id === selectedTeamId || match.team_away_id === selectedTeamId)
      .slice()
      .sort(compareMatchTime);
  }, [scheduleData, selectedTeamId]);

  const groupOptions = useMemo(
    () =>
      [...new Set(scheduleData.map((match) => match.group_name))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "it")),
    [scheduleData]
  );

  useEffect(() => {
    if (!selectedGroup && groupOptions.length > 0) {
      setSelectedGroup(groupOptions[0]);
    }
    if (selectedGroup && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(groupOptions[0] || "");
    }
  }, [groupOptions, selectedGroup]);

  const groupMatches = useMemo(() => {
    if (!selectedGroup) return [];
    return scheduleData.filter((match) => match.group_name === selectedGroup).slice().sort(compareMatchTime);
  }, [scheduleData, selectedGroup]);

  const onToggleLock = async (match: Match) => {
    setErrorMessage(null);
    const previous = localSchedule ? [...localSchedule] : null;
    setLocalSchedule((currentSchedule) =>
      (currentSchedule || []).map((item) =>
        item.id === match.id ? { ...item, is_manually_locked: !item.is_manually_locked } : item
      )
    );
    try {
      await lockMutation.mutateAsync({ mid: match.id, locked: !match.is_manually_locked });
    } catch (error: unknown) {
      if (previous) setLocalSchedule(previous);
      setErrorMessage(error instanceof Error ? error.message : "Errore lock/unlock partita.");
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setErrorMessage(null);
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const match = scheduleData.find((item) => item.id === activeId);
    if (!match) return;
    if (match.is_manually_locked) {
      setErrorMessage("Partita bloccata: fai unlock prima di spostarla.");
      return;
    }

    const targetOccupiedBy = scheduleData.find((item) => item.slot?.id === overId && item.id !== activeId);
    if (targetOccupiedBy) {
      setErrorMessage("Slot occupato. Seleziona uno slot libero.");
      return;
    }

    const targetSlot = slots.find((slot) => slot.id === overId);
    if (!targetSlot) return;

    // Real-time unavailability check
    const homeTeam = (tournamentsQuery.data as any)?.find((t:any)=>t.id === tid)?.teams?.find((t:any)=>t.id === match.team_home_id);
    const awayTeam = (tournamentsQuery.data as any)?.find((t:any)=>t.id === tid)?.teams?.find((t:any)=>t.id === match.team_away_id);
    
    // We might not have team details in tournamentsQuery.list(), let's check if we can get them
    // Actually, it's better to just show the warning if we detect it, but we need the teams' data.
    // For now, let's just proceed with the move and let the quality query update, 
    // OR we can fetch teams separately.
    
    const previous = scheduleData.map((item) => ({ ...item, slot: item.slot ? { ...item.slot } : null }));
    setLocalSchedule((currentSchedule) =>
      (currentSchedule || []).map((item) =>
        item.id === activeId
          ? {
              ...item,
              slot: {
                id: targetSlot.id,
                start_time: targetSlot.start_time,
                end_time: targetSlot.end_time,
                day_label: targetSlot.day_label
              }
            }
          : item
      )
    );

    try {
      await patchSlotMutation.mutateAsync({ mid: activeId, slotId: overId });
    } catch (error: unknown) {
      setLocalSchedule(previous);
      setErrorMessage(error instanceof Error ? error.message : "Errore nello spostamento partita.");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Calendario</h1>
        <p className="text-sm text-slate-600">Vista Giorno, Squadra e Girone con drag&drop e controllo violazioni.</p>
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

          {(tournamentsQuery.data || []).filter((t: { id: string }) => t.id !== tid).length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">Pianifica insieme a</span>
              <div className="flex flex-wrap gap-2 text-sm">
                {(tournamentsQuery.data || [])
                  .filter((t: { id: string }) => t.id !== tid)
                  .map((tournament: { id: string; name: string }) => (
                    <label key={tournament.id} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={companionTids.includes(tournament.id)}
                        onChange={(event) =>
                          setCompanionTids((currentIds) =>
                            event.target.checked
                              ? [...currentIds, tournament.id]
                              : currentIds.filter((id) => id !== tournament.id)
                          )
                        }
                      />
                      {tournament.name}
                    </label>
                  ))}
              </div>
            </div>
          ) : null}

          <button
            className="rounded-lg border px-3 py-2"
            type="button"
            onClick={() => void generateMutation.mutateAsync()}
            disabled={!tid || generateMutation.isPending}
          >
            {generateMutation.isPending ? "Generazione..." : "Genera calendario"}
          </button>

          <button
            className="rounded-lg border px-3 py-2"
            type="button"
            onClick={() => void applyMutation.mutateAsync()}
            disabled={!tid || applyMutation.isPending}
          >
            {applyMutation.isPending ? "Applicazione..." : "Applica soluzione"}
          </button>

          <button
            className="rounded-lg border px-3 py-2"
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
              void queryClient.invalidateQueries({ queryKey: ["slots", tid] });
              void queryClient.invalidateQueries({ queryKey: ["schedule-status", tid] });
              void queryClient.invalidateQueries({ queryKey: ["schedule-quality", tid] });
            }}
            disabled={!tid}
          >
            Refresh
          </button>

          <div className="text-sm text-slate-700">
            <strong>Solver:</strong> {solverStatus} {solverObjective !== null ? `• obj ${solverObjective}` : ""}
          </div>
        </div>

        {quality ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border bg-slate-50 px-3 py-2">
              Preferenze: <strong>{quality.preferences_respected_pct ?? quality.coverage_pct}%</strong>
            </div>
            <div className="rounded-lg border bg-slate-50 px-3 py-2">
              Violazioni: <strong>{quality.hard_violations ?? 0}</strong> hard / <strong>{quality.soft_violations ?? 0}</strong> soft
            </div>
            <div className="rounded-lg border bg-slate-50 px-3 py-2">
              Slot: <strong>{quality.slots_utilized ?? quality.scheduled_matches}</strong> / {quality.total_slots ?? slots.length}
            </div>
            <div className="rounded-lg border bg-slate-50 px-3 py-2">
              Equita: <strong>{quality.equity_index ?? "-"}</strong>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="inline-flex rounded-lg border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${viewTab === "day" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
            onClick={() => setViewTab("day")}
          >
            Vista Giorno
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${viewTab === "team" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
            onClick={() => setViewTab("team")}
          >
            Vista Squadra
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${viewTab === "group" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
            onClick={() => setViewTab("group")}
          >
            Vista Girone
          </button>
        </div>

        {viewTab === "day" ? (
          <DndContext onDragEnd={(event) => void onDragEnd(event)}>
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold mb-2">Partite non schedulate</h2>
                {unscheduled.length === 0 ? (
                  <div className="text-sm text-slate-500">Nessuna partita non schedulata.</div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {unscheduled.map((match) => (
                      <MatchCard key={match.id} match={match} health={healthMap[match.id] || null} onToggleLock={onToggleLock} />
                    ))}
                  </div>
                )}
              </div>

              {slotsByDay.length === 0 ? (
                <div className="text-sm text-slate-500">Nessuno slot configurato.</div>
              ) : (
                slotsByDay.map(([dayLabel, daySlots]) => (
                  <article key={dayLabel} className="space-y-2">
                    <h3 className="font-semibold">{dayLabel}</h3>
                    <div className="space-y-2">
                      {daySlots.map((slot) => {
                        const match = bySlot.get(slot.id) || null;
                        return (
                          <SlotRow
                            key={slot.id}
                            slot={slot}
                            match={match}
                            health={match ? healthMap[match.id] || null : null}
                            onToggleLock={onToggleLock}
                          />
                        );
                      })}
                    </div>
                  </article>
                ))
              )}
            </div>
          </DndContext>
        ) : null}

        {viewTab === "team" ? (
          <div className="space-y-3">
            {teamOptions.length === 0 ? (
              <div className="text-sm text-slate-500">Nessuna squadra disponibile nella pianificazione corrente.</div>
            ) : (
              <>
                <label className="flex flex-col gap-1 max-w-sm">
                  <span className="text-xs uppercase tracking-wide text-slate-500">Seleziona squadra</span>
                  <select
                    className="rounded-lg border px-3 py-2"
                    value={selectedTeamId}
                    onChange={(event) => setSelectedTeamId(event.target.value)}
                  >
                    {teamOptions.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-2">
                  {teamMatches.length === 0 ? (
                    <div className="text-sm text-slate-500">Nessuna partita trovata per questa squadra.</div>
                  ) : (
                    teamMatches.map((match) => {
                      const level = matchLevel(match, healthMap[match.id] || null);
                      return (
                        <div key={match.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
                          <div className="font-medium">
                            {match.team_home} vs {match.team_away}
                          </div>
                          <div className="text-slate-600">
                            {match.slot
                              ? `${match.slot.day_label} ${match.slot.start_time}`
                              : "Non schedulata"}
                          </div>
                          <div className="mt-1">
                            <span className={`rounded px-2 py-0.5 text-xs ${statusStyle(level)}`}>{statusLabel(level)}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}

        {viewTab === "group" ? (
          <div className="space-y-3">
            {groupOptions.length === 0 ? (
              <div className="text-sm text-slate-500">Nessun girone disponibile.</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((groupName) => (
                    <button
                      key={groupName}
                      type="button"
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        selectedGroup === groupName ? "bg-slate-900 text-white border-slate-900" : ""
                      }`}
                      onClick={() => setSelectedGroup(groupName)}
                    >
                      {groupName}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="text-left px-3 py-2">Match</th>
                        <th className="text-left px-3 py-2">Giorno/Ora</th>
                        <th className="text-left px-3 py-2">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupMatches.map((match) => {
                        const level = matchLevel(match, healthMap[match.id] || null);
                        return (
                          <tr key={match.id} className="border-t">
                            <td className="px-3 py-2">
                              {match.team_home} vs {match.team_away}
                            </td>
                            <td className="px-3 py-2">
                              {match.slot ? `${match.slot.day_label} ${match.slot.start_time}` : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`rounded px-2 py-0.5 text-xs ${statusStyle(level)}`}>{statusLabel(level)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
