import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { scheduleApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, ScheduleQuality, Slot, Tournament } from "../types";
import { buildTournamentPairs } from "../utils/tournamentPairs";

type MatchHealth = { level: "ok" | "soft" | "hard"; hard: string[]; soft: string[] };

function isPlayed(match: Match) {
  return String(match.status || "").toLowerCase().includes("played");
}

function levelStyle(level: "ok" | "soft" | "hard" | "unscheduled" | "played") {
  if (level === "ok") return { bg: "rgba(0,230,118,0.12)", color: "#00e676", label: "OK" };
  if (level === "soft") return { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", label: "Soft" };
  if (level === "hard") return { bg: "rgba(239,68,68,0.12)", color: "#f87171", label: "Hard" };
  if (level === "played") return { bg: "rgba(147,51,234,0.12)", color: "#c084fc", label: "Giocata" };
  return { bg: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)", label: "Non schedulata" };
}

function levelOf(match: Match, health: MatchHealth | null) {
  if (isPlayed(match)) return "played" as const;
  if (!match.slot) return "unscheduled" as const;
  return (health?.level || "ok") as "ok" | "soft" | "hard";
}

function getWsUrl(tid: string) {
  const apiBase = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  const wsBase = apiBase.startsWith("https://") ? apiBase.replace("https://", "wss://") : apiBase.replace("http://", "ws://");
  return `${wsBase}/api/tournaments/ws/${tid}/solver`;
}

function aggregateQuality(items: ScheduleQuality[]): ScheduleQuality {
  const total_matches = items.reduce((a, i) => a + (i.total_matches || 0), 0);
  const scheduled_matches = items.reduce((a, i) => a + (i.scheduled_matches || 0), 0);
  const unscheduled_matches = items.reduce((a, i) => a + (i.unscheduled_matches || 0), 0);
  const match_health = items.reduce((acc, i) => ({ ...acc, ...(i.match_health || {}) }), {} as Record<string, MatchHealth>);
  return {
    total_matches,
    scheduled_matches,
    unscheduled_matches,
    coverage_pct: total_matches > 0 ? Number(((scheduled_matches / total_matches) * 100).toFixed(1)) : 0,
    locked_matches: items.reduce((a, i) => a + (i.locked_matches || 0), 0),
    slot_conflicts: items.reduce((a, i) => a + (i.slot_conflicts || 0), 0),
    total_slots: items.reduce((a, i) => a + (i.total_slots || 0), 0),
    slots_utilized: items.reduce((a, i) => a + (i.slots_utilized || 0), 0),
    hard_violations: items.reduce((a, i) => a + (i.hard_violations || 0), 0),
    soft_violations: items.reduce((a, i) => a + (i.soft_violations || 0), 0),
    preference_checks: items.reduce((a, i) => a + (i.preference_checks || 0), 0),
    preference_respected: items.reduce((a, i) => a + (i.preference_respected || 0), 0),
    preferences_respected_pct: (() => {
      const checks = items.reduce((a, i) => a + (i.preference_checks || 0), 0);
      const respected = items.reduce((a, i) => a + (i.preference_respected || 0), 0);
      return checks > 0 ? Number(((respected / checks) * 100).toFixed(1)) : 100;
    })(),
    equity_index: 1,
    alerts: items.flatMap((i) => i.alerts || []).slice(0, 40),
    match_health,
  };
}

type CardProps = {
  match: Match;
  health: MatchHealth | null;
  onToggleLock: (m: Match) => void;
  onUnschedule: (m: Match) => void;
};

function MatchCard({ match, health, onToggleLock, onUnschedule }: CardProps) {
  const played = isPlayed(match);
  const disabled = played || match.is_manually_locked;
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: match.id, disabled });
  const st = levelStyle(levelOf(match, health));
  const gColor = match.gender?.toUpperCase() === "F" ? "#f472b6" : "#60a5fa";
  const gBg = match.gender?.toUpperCase() === "F" ? "rgba(236,72,153,0.12)" : "rgba(59,130,246,0.12)";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined, cursor: disabled ? "default" : "grab" }}
      className="rounded-xl p-3"
    >
      <div className="font-semibold text-sm">{match.team_home} <span style={{ color: "rgba(255,255,255,0.35)" }}>vs</span> {match.team_away}</div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: gBg, color: gColor }}>{match.gender?.toUpperCase()}</span>
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{match.group_name}</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
        <button type="button" className="text-xs px-2 py-0.5 rounded" onClick={() => onToggleLock(match)} disabled={played}>
          {match.is_manually_locked ? "Unlock" : "Lock"}
        </button>
        <button type="button" className="text-xs px-2 py-0.5 rounded" onClick={() => onUnschedule(match)} disabled={played || !match.slot}>
          Annulla
        </button>
      </div>
    </div>
  );
}

function SlotRow({ slot, match, health, onToggleLock, onUnschedule }: { slot: Slot; match: Match | null; health: MatchHealth | null; onToggleLock: (m: Match) => void; onUnschedule: (m: Match) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: slot.id });
  return (
    <div ref={setNodeRef} className="grid gap-3 rounded-xl p-2" style={{ gridTemplateColumns: "72px 1fr", border: `1px solid ${isOver ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.08)"}` }}>
      <div className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>{slot.start_time}</div>
      {match ? <MatchCard match={match} health={health} onToggleLock={onToggleLock} onUnschedule={onUnschedule} /> : <div className="text-xs px-3" style={{ color: "rgba(255,255,255,0.3)" }}>Slot libero</div>}
    </div>
  );
}

export function Schedule() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverStatus, setSolverStatus] = useState<string>("idle");
  const [solverObjective, setSolverObjective] = useState<number | null>(null);
  const [localSchedule, setLocalSchedule] = useState<Match[] | null>(null);
  const [selectedPairKey, setSelectedPairKey] = useState<string>("");
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [viewTab, setViewTab] = useState<"day" | "team" | "group">("day");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const generateStartedAt = useRef<number>(0);

  const tournamentsQuery = useQuery({ queryKey: ["tournaments"], queryFn: () => tournamentApi.list() });
  const tournaments = (tournamentsQuery.data || []) as Tournament[];
  const pairs = useMemo(() => buildTournamentPairs(tournaments), [tournaments]);
  const selectedPair = useMemo(() => pairs.find((p) => p.key === selectedPairKey) ?? null, [pairs, selectedPairKey]);

  useEffect(() => {
    if (pairs.length > 0) {
      if (selectedPairKey && pairs.some((p) => p.key === selectedPairKey)) return;
      const fromCurrent = current ? pairs.find((p) => p.male?.id === current.id || p.female?.id === current.id) : null;
      setSelectedPairKey((fromCurrent || pairs[0]).key);
      return;
    }
    if (!selectedTournamentId && tournaments.length > 0) setSelectedTournamentId(current?.id || tournaments[0].id);
  }, [current?.id, pairs, selectedPairKey, selectedTournamentId, tournaments]);

  const tids = useMemo(() => {
    if (pairs.length > 0 && selectedPair) {
      return [selectedPair.male?.id, selectedPair.female?.id].filter(Boolean) as string[];
    }
    return selectedTournamentId ? [selectedTournamentId] : current?.id ? [current.id] : [];
  }, [current?.id, pairs.length, selectedPair, selectedTournamentId]);

  const primaryTid = tids[0] || "";

  useEffect(() => {
    if (!primaryTid) return;
    const found = tournaments.find((t) => t.id === primaryTid);
    if (found && current?.id !== found.id) setCurrent(found);
  }, [current?.id, primaryTid, setCurrent, tournaments]);

  const slotsQuery = useQuery({
    queryKey: ["slots-pair", ...tids],
    queryFn: async () => (await Promise.all(tids.map((id) => tournamentApi.getSlots(id)))).flat() as Slot[],
    enabled: tids.length > 0,
  });

  const scheduleQuery = useQuery({
    queryKey: ["schedule-pair", ...tids],
    queryFn: async () => (await Promise.all(tids.map((id) => tournamentApi.getSchedule(id)))).flat() as Match[],
    enabled: tids.length > 0,
  });

  const scheduleStatusQuery = useQuery({
    queryKey: ["schedule-status", primaryTid],
    queryFn: () => tournamentApi.getScheduleStatus(primaryTid),
    enabled: Boolean(primaryTid),
    refetchInterval: 4000,
  });

  const qualityQuery = useQuery({
    queryKey: ["schedule-quality-pair", ...tids],
    queryFn: async () => aggregateQuality(await Promise.all(tids.map((id) => tournamentApi.getScheduleQuality(id))) as ScheduleQuality[]),
    enabled: tids.length > 0,
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (scheduleQuery.data) setLocalSchedule((scheduleQuery.data as Match[]).slice());
  }, [scheduleQuery.data]);

  useEffect(() => {
    const status = scheduleStatusQuery.data as { status?: string; result?: { objective?: number } } | undefined;
    if (!status?.status) return;
    if ((status.status === "error" || status.status === "idle") && Date.now() - generateStartedAt.current < 2000) return;
    setSolverStatus(status.status);
    if (typeof status.result?.objective === "number") setSolverObjective(status.result.objective);
  }, [scheduleStatusQuery.data]);

  useEffect(() => {
    if (!primaryTid) return;
    const ws = new WebSocket(getWsUrl(primaryTid));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type?: string; status?: string; objective?: number; message?: string };
        if (msg.type === "solution" && typeof msg.objective === "number") { setSolverObjective(msg.objective); setSolverStatus("running"); }
        if (msg.type === "done" && msg.status) setSolverStatus(msg.status);
        if (msg.type === "error") setErrorMessage(`Errore solver: ${msg.message ?? "sconosciuto"}`);
      } catch {
        // no-op
      }
    };
    return () => ws.close();
  }, [primaryTid]);

  const invalidatePair = async () => {
    await queryClient.invalidateQueries({ queryKey: ["schedule-pair"] });
    await queryClient.invalidateQueries({ queryKey: ["slots-pair"] });
    await queryClient.invalidateQueries({ queryKey: ["schedule-quality-pair"] });
    await queryClient.invalidateQueries({ queryKey: ["schedule-status", primaryTid] });
  };

  const generateMutation = useMutation({
    mutationFn: () => {
      generateStartedAt.current = Date.now();
      setSolverStatus("running");
      return tournamentApi.generateSchedule(primaryTid);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["schedule-status", primaryTid] }); },
  });

  const saveMutation = useMutation({ mutationFn: () => tournamentApi.saveSchedule(primaryTid), onSuccess: invalidatePair });
  const unscheduleAllMutation = useMutation({ mutationFn: () => tournamentApi.unscheduleAll(primaryTid), onSuccess: invalidatePair });
  const patchSlotMutation = useMutation({ mutationFn: ({ mid, slotId }: { mid: string; slotId: string }) => scheduleApi.patchMatchSlot(mid, slotId), onSuccess: invalidatePair });
  const lockMutation = useMutation({ mutationFn: ({ mid, locked }: { mid: string; locked: boolean }) => scheduleApi.patchMatchLock(mid, locked), onSuccess: invalidatePair });
  const unscheduleOneMutation = useMutation({ mutationFn: ({ mid }: { mid: string }) => scheduleApi.unscheduleMatch(mid), onSuccess: invalidatePair });

  const scheduleData = (localSchedule || []) as Match[];
  const slots = ((slotsQuery.data || []) as Slot[]).slice().sort((a, b) => a.day_label.localeCompare(b.day_label, "it") || a.start_time.localeCompare(b.start_time, "it"));
  const quality = (qualityQuery.data || null) as ScheduleQuality | null;
  const healthMap = (quality?.match_health || {}) as Record<string, MatchHealth>;

  const bySlot = useMemo(() => {
    const map = new Map<string, Match>();
    for (const m of scheduleData) if (m.slot?.id) map.set(m.slot.id, m);
    return map;
  }, [scheduleData]);

  const unscheduled = scheduleData.filter((m) => !m.slot && !isPlayed(m));
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
    for (const m of scheduleData) {
      if (m.team_home_id) map.set(m.team_home_id, m.team_home);
      if (m.team_away_id) map.set(m.team_away_id, m.team_away);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [scheduleData]);

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) setSelectedTeamId(teamOptions[0].id);
    if (selectedTeamId && !teamOptions.some((t) => t.id === selectedTeamId)) setSelectedTeamId(teamOptions[0]?.id || "");
  }, [selectedTeamId, teamOptions]);

  const groupOptions = useMemo(() => [...new Set(scheduleData.map((m) => m.group_name))].filter(Boolean).sort((a, b) => a.localeCompare(b, "it")), [scheduleData]);

  useEffect(() => {
    if (!selectedGroup && groupOptions.length > 0) setSelectedGroup(groupOptions[0]);
    if (selectedGroup && !groupOptions.includes(selectedGroup)) setSelectedGroup(groupOptions[0] || "");
  }, [groupOptions, selectedGroup]);

  const teamMatches = useMemo(() => selectedTeamId ? scheduleData.filter((m) => m.team_home_id === selectedTeamId || m.team_away_id === selectedTeamId).sort((a, b) => (a.slot?.day_label || "").localeCompare(b.slot?.day_label || "", "it") || (a.slot?.start_time || "").localeCompare(b.slot?.start_time || "", "it")) : [], [scheduleData, selectedTeamId]);
  const groupMatches = useMemo(() => selectedGroup ? scheduleData.filter((m) => m.group_name === selectedGroup).sort((a, b) => (a.slot?.day_label || "").localeCompare(b.slot?.day_label || "", "it") || (a.slot?.start_time || "").localeCompare(b.slot?.start_time || "", "it")) : [], [scheduleData, selectedGroup]);

  const onToggleLock = async (match: Match) => {
    if (isPlayed(match)) { setErrorMessage("Partita gia giocata: modifica non consentita."); return; }
    const previous = localSchedule ? [...localSchedule] : null;
    setLocalSchedule((curr) => (curr || []).map((m) => (m.id === match.id ? { ...m, is_manually_locked: !m.is_manually_locked } : m)));
    try { await lockMutation.mutateAsync({ mid: match.id, locked: !match.is_manually_locked }); }
    catch (error: unknown) { if (previous) setLocalSchedule(previous); setErrorMessage(error instanceof Error ? error.message : "Errore lock/unlock."); }
  };

  const onUnschedule = async (match: Match) => {
    if (isPlayed(match)) { setErrorMessage("Partita gia giocata: modifica non consentita."); return; }
    if (!match.slot) return;
    const previous = localSchedule ? [...localSchedule] : null;
    setLocalSchedule((curr) => (curr || []).map((m) => (m.id === match.id ? { ...m, slot: null, is_manually_locked: false, status: "pending" } : m)));
    try { await unscheduleOneMutation.mutateAsync({ mid: match.id }); }
    catch (error: unknown) { if (previous) setLocalSchedule(previous); setErrorMessage(error instanceof Error ? error.message : "Errore annullamento."); }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const match = scheduleData.find((m) => m.id === activeId);
    if (!match) return;
    if (isPlayed(match)) { setErrorMessage("Partita gia giocata: modifica non consentita."); return; }
    if (match.is_manually_locked) { setErrorMessage("Partita bloccata: fai unlock prima di spostarla."); return; }
    if (scheduleData.some((m) => m.slot?.id === overId && m.id !== activeId)) { setErrorMessage("Slot occupato."); return; }
    const targetSlot = slots.find((s) => s.id === overId);
    if (!targetSlot) return;
    const previous = scheduleData.map((m) => ({ ...m, slot: m.slot ? { ...m.slot } : null }));
    setLocalSchedule((curr) => (curr || []).map((m) => (m.id === activeId ? { ...m, slot: { id: targetSlot.id, day_id: targetSlot.day_id, start_time: targetSlot.start_time, end_time: targetSlot.end_time, day_label: targetSlot.day_label } } : m)));
    try { await patchSlotMutation.mutateAsync({ mid: activeId, slotId: overId }); }
    catch (error: unknown) { setLocalSchedule(previous); setErrorMessage(error instanceof Error ? error.message : "Errore nello spostamento."); }
  };

  const solverColor = solverStatus === "running" ? "#3b82f6" : solverStatus === "done" || solverStatus === "optimal" ? "#00e676" : solverStatus === "error" || solverStatus === "infeasible" ? "#ef4444" : "rgba(255,255,255,0.3)";

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>Pianificazione</div>
        <h1 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800 }}>Calendario</h1>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

      <div className="sport-card p-5 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>{pairs.length > 0 ? "Edizione" : "Torneo attivo"}</span>
            {pairs.length > 0 ? (
              <select className="sport-select min-w-52" value={selectedPairKey} onChange={(e) => setSelectedPairKey(e.target.value)}>{pairs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            ) : (
              <select className="sport-select min-w-52" value={selectedTournamentId} onChange={(e) => setSelectedTournamentId(e.target.value)}>{tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            )}
          </div>
          <button className="sport-btn-primary" type="button" onClick={() => void generateMutation.mutateAsync()} disabled={!primaryTid || generateMutation.isPending}>{generateMutation.isPending ? "Generazione..." : "Genera calendario"}</button>
          <button className="sport-btn-secondary" type="button" onClick={() => void unscheduleAllMutation.mutateAsync()} disabled={!primaryTid || unscheduleAllMutation.isPending}>{unscheduleAllMutation.isPending ? "Annullamento..." : "Annulla tutte"}</button>
          <button className="sport-btn-secondary" type="button" onClick={() => void saveMutation.mutateAsync()} disabled={!primaryTid || saveMutation.isPending}>{saveMutation.isPending ? "Salvataggio..." : "Salva calendario"}</button>
          <button className="sport-btn-secondary" type="button" disabled={!primaryTid} onClick={() => { void invalidatePair(); }}>Refresh</button>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: solverColor, boxShadow: `0 0 6px ${solverColor}` }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: solverColor }}>{solverStatus}</span>
            {solverObjective !== null && <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>obj {solverObjective}</span>}
          </div>
        </div>

        {quality && (
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Pianificate", value: `${quality.scheduled_matches} / ${quality.total_matches}`, color: quality.scheduled_matches === quality.total_matches ? "#00e676" : "#f59e0b" },
              { label: "Non pianificate", value: String(quality.unscheduled_matches || 0), color: (quality.unscheduled_matches || 0) > 0 ? "#f59e0b" : "#00e676" },
              { label: "Hard", value: String(quality.hard_violations || 0), color: (quality.hard_violations || 0) > 0 ? "#f87171" : "#00e676" },
              { label: "Soft", value: String(quality.soft_violations || 0), color: (quality.soft_violations || 0) > 0 ? "#f59e0b" : "#00e676" },
              { label: "Preferenze", value: `${quality.preferences_respected_pct || 0}%`, color: "#3b82f6" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl px-3 py-2 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
                <span className="text-sm font-bold" style={{ fontFamily: "Rajdhani, sans-serif", color }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["day", "team", "group"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setViewTab(tab)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={viewTab === tab ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" } : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {tab === "day" ? "Vista Giorno" : tab === "team" ? "Vista Squadra" : "Vista Girone"}
          </button>
        ))}
      </div>

      {viewTab === "day" && (
        <DndContext onDragEnd={(event) => void onDragEnd(event)}>
          <div className="space-y-5">
            {unscheduled.length > 0 && (
              <div className="sport-card p-4">
                <div className="flex items-center gap-2 mb-3"><h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 18, fontWeight: 700 }}>Partite non schedulate</h2><span className="sport-badge-orange">{unscheduled.length}</span></div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{unscheduled.map((m) => <MatchCard key={m.id} match={m} health={healthMap[m.id] || null} onToggleLock={onToggleLock} onUnschedule={onUnschedule} />)}</div>
              </div>
            )}
            {slotsByDay.map(([dayLabel, daySlots]) => (
              <div key={dayLabel} className="sport-card overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  <h3 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{dayLabel}</h3>
                </div>
                <div className="p-3 space-y-2">{daySlots.map((slot) => <SlotRow key={slot.id} slot={slot} match={bySlot.get(slot.id) || null} health={bySlot.get(slot.id) ? healthMap[(bySlot.get(slot.id) as Match).id] || null : null} onToggleLock={onToggleLock} onUnschedule={onUnschedule} />)}</div>
              </div>
            ))}
          </div>
        </DndContext>
      )}

      {viewTab === "team" && (
        <div className="sport-card p-5 space-y-4">
          <div className="flex flex-col gap-1 max-w-xs">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Seleziona squadra</span>
            <select className="sport-select" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>{teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
          <div className="space-y-2">{teamMatches.map((m) => <MatchCard key={m.id} match={m} health={healthMap[m.id] || null} onToggleLock={onToggleLock} onUnschedule={onUnschedule} />)}</div>
        </div>
      )}

      {viewTab === "group" && (
        <div className="sport-card p-5 space-y-4">
          <div className="flex flex-wrap gap-2">{groupOptions.map((name) => <button key={name} type="button" onClick={() => setSelectedGroup(name)} className="px-3 py-2 text-sm font-semibold rounded-xl" style={selectedGroup === name ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" } : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>{name}</button>)}</div>
          <div className="space-y-2">{groupMatches.map((m) => <MatchCard key={m.id} match={m} health={healthMap[m.id] || null} onToggleLock={onToggleLock} onUnschedule={onUnschedule} />)}</div>
        </div>
      )}
    </div>
  );
}
