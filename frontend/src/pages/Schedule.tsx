import { useEffect, useMemo, useState } from "react";

import { DndContext, DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { scheduleApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, Slot } from "../types";

type MatchCardProps = {
  match: Match;
  onToggleLock: (match: Match) => void;
};

function MatchCard({ match, onToggleLock }: MatchCardProps) {
  const disabled = match.is_manually_locked;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: match.id,
    disabled
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.6 : 1
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`border rounded p-2 bg-white shadow-sm text-sm ${disabled ? "opacity-60" : "cursor-grab"}`}
    >
      <div className="font-semibold">
        {match.team_home} vs {match.team_away}
      </div>
      <div className="text-slate-600">
        {match.group_name} • {match.phase}
      </div>
      <div className="mt-2 flex gap-2">
        <span className="px-2 py-0.5 rounded bg-slate-100">{match.status}</span>
        <button className="px-2 py-0.5 border rounded" type="button" onClick={() => onToggleLock(match)}>
          {match.is_manually_locked ? "Unlock" : "Lock"}
        </button>
      </div>
    </div>
  );
}

type SlotDropProps = {
  slot: Slot;
  match: Match | null;
  onToggleLock: (match: Match) => void;
};

function SlotDropZone({ slot, match, onToggleLock }: SlotDropProps) {
  const { isOver, setNodeRef } = useDroppable({ id: slot.id });
  return (
    <div ref={setNodeRef} className={`border rounded p-2 min-h-28 ${isOver ? "bg-blue-50 border-blue-300" : "bg-slate-50"}`}>
      <div className="text-xs text-slate-600 mb-2">
        {slot.day_label} • {slot.start_time}-{slot.end_time}
      </div>
      {match ? <MatchCard match={match} onToggleLock={onToggleLock} /> : <div className="text-xs text-slate-400">Slot libero</div>}
    </div>
  );
}

function getWsUrl(tournamentId: string) {
  const apiBase = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  const wsBase = apiBase.startsWith("https://") ? apiBase.replace("https://", "wss://") : apiBase.replace("http://", "ws://");
  return `${wsBase}/api/tournaments/ws/${tournamentId}/solver`;
}

export function Schedule() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverStatus, setSolverStatus] = useState<string>("idle");
  const [solverObjective, setSolverObjective] = useState<number | null>(null);
  const [localSchedule, setLocalSchedule] = useState<Match[] | null>(null);

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
        // ignore parse error
      }
    };
    return () => ws.close();
  }, [tid]);

  const generateMutation = useMutation({
    mutationFn: () => tournamentApi.generateSchedule(tid),
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
    }
  });
  const patchSlotMutation = useMutation({
    mutationFn: ({ mid, slotId }: { mid: string; slotId: string }) => scheduleApi.patchMatchSlot(mid, slotId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["slots", tid] });
    }
  });
  const lockMutation = useMutation({
    mutationFn: ({ mid, locked }: { mid: string; locked: boolean }) => scheduleApi.patchMatchLock(mid, locked),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
    }
  });

  const scheduleData = (localSchedule || []) as Match[];
  const slots = ((slotsQuery.data || []) as Slot[]).slice().sort((a, b) => {
    const day = a.day_label.localeCompare(b.day_label);
    if (day !== 0) return day;
    return a.start_time.localeCompare(b.start_time);
  });

  const bySlot = useMemo(() => {
    const map = new Map<string, Match>();
    scheduleData.forEach((m) => {
      if (m.slot?.id) map.set(m.slot.id, m);
    });
    return map;
  }, [scheduleData]);

  const unscheduled = scheduleData.filter((m) => !m.slot);

  const onToggleLock = async (match: Match) => {
    setErrorMessage(null);
    const previous = localSchedule ? [...localSchedule] : null;
    setLocalSchedule((curr) =>
      (curr || []).map((m) => (m.id === match.id ? { ...m, is_manually_locked: !m.is_manually_locked } : m))
    );
    try {
      await lockMutation.mutateAsync({ mid: match.id, locked: !match.is_manually_locked });
    } catch (e: unknown) {
      if (previous) setLocalSchedule(previous);
      setErrorMessage(e instanceof Error ? e.message : "Errore lock/unlock partita.");
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setErrorMessage(null);
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const match = scheduleData.find((m) => m.id === activeId);
    if (!match) return;
    if (match.is_manually_locked) {
      setErrorMessage("Partita bloccata: unlock prima di spostare.");
      return;
    }

    const targetOccupiedBy = scheduleData.find((m) => m.slot?.id === overId && m.id !== activeId);
    if (targetOccupiedBy) {
      setErrorMessage("Slot occupato. Scegli uno slot libero.");
      return;
    }

    const targetSlot = slots.find((s) => s.id === overId);
    if (!targetSlot) return;

    const previous = scheduleData.map((m) => ({ ...m, slot: m.slot ? { ...m.slot } : null }));
    setLocalSchedule((curr) =>
      (curr || []).map((m) =>
        m.id === activeId
          ? {
              ...m,
              slot: {
                id: targetSlot.id,
                start_time: targetSlot.start_time,
                end_time: targetSlot.end_time,
                day_label: targetSlot.day_label
              }
            }
          : m
      )
    );

    try {
      await patchSlotMutation.mutateAsync({ mid: activeId, slotId: overId });
    } catch (e: unknown) {
      setLocalSchedule(previous);
      setErrorMessage(e instanceof Error ? e.message : "Errore nello spostamento partita.");
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendario</h1>
          <p className="text-slate-600">Generazione solver, editing manuale drag&drop, lock/unlock partite.</p>
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

        <button className="px-3 py-2 border rounded" type="button" onClick={() => void generateMutation.mutateAsync()} disabled={!tid}>
          Genera calendario
        </button>
        <button className="px-3 py-2 border rounded" type="button" onClick={() => void applyMutation.mutateAsync()} disabled={!tid}>
          Applica soluzione
        </button>
        <button
          className="px-3 py-2 border rounded"
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
            void queryClient.invalidateQueries({ queryKey: ["slots", tid] });
            void queryClient.invalidateQueries({ queryKey: ["schedule-status", tid] });
          }}
          disabled={!tid}
        >
          Refresh
        </button>

        <div className="text-sm text-slate-700">
          <strong>Solver:</strong> {solverStatus} {solverObjective !== null ? `• obj ${solverObjective}` : ""}
        </div>
      </section>

      <section className="bg-white p-4 rounded shadow space-y-3">
        <h2 className="font-semibold">Partite non assegnate</h2>
        {unscheduled.length === 0 ? (
          <div className="text-sm text-slate-500">Nessuna partita non assegnata.</div>
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {unscheduled.map((m) => (
              <MatchCard key={m.id} match={m} onToggleLock={onToggleLock} />
            ))}
          </div>
        )}
      </section>

      <DndContext onDragEnd={(e) => void onDragEnd(e)}>
        <section className="bg-white p-4 rounded shadow">
          <h2 className="font-semibold mb-3">Board slot (drop target)</h2>
          {slotsQuery.isLoading || scheduleQuery.isLoading ? (
            <div className="text-sm text-slate-500">Caricamento calendario...</div>
          ) : slots.length === 0 ? (
            <div className="text-sm text-slate-500">Nessuno slot disponibile.</div>
          ) : (
            <div className="grid md:grid-cols-3 gap-3">
              {slots.map((slot) => (
                <SlotDropZone key={slot.id} slot={slot} match={bySlot.get(slot.id) || null} onToggleLock={onToggleLock} />
              ))}
            </div>
          )}
        </section>
      </DndContext>
    </div>
  );
}
