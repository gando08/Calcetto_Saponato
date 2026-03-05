import { useEffect, useMemo, useRef, useState } from "react";

function translateReason(reason: string): string {
  if (reason === "non_schedulato") return "Partita non schedulata (nessuno slot disponibile)";
  if (reason === "slot_non_valido") return "Slot non valido per questa partita";
  if (reason === "slot_conflitto") return "Conflitto di slot (stesso orario)";
  if (reason.startsWith("indisponibilita:")) return `Squadra ${reason.slice(16)} non disponibile in questo slot`;
  if (reason.startsWith("giorno_non_preferito:")) return `Giorno non preferito da ${reason.slice(21)}`;
  if (reason.startsWith("fascia_non_preferita:")) return `Fascia oraria non preferita da ${reason.slice(21)}`;
  if (reason.startsWith("3_partite_consecutive:")) return `3+ partite consecutive per ${reason.slice(22)}`;
  return reason;
}

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { scheduleApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, ScheduleQuality, Slot, Tournament } from "../types";
import { buildTournamentPairs, getTournamentIdForGender } from "../utils/tournamentPairs";

type MatchHealth = { level: "ok" | "soft" | "hard"; hard: string[]; soft: string[] };

function statusStyle(level: "ok" | "soft" | "hard" | "unscheduled") {
  if (level === "ok") return { bg: "rgba(0,230,118,0.1)", color: "#00e676", border: "rgba(0,230,118,0.25)", label: "OK" };
  if (level === "soft") return { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "rgba(245,158,11,0.25)", label: "Soft" };
  if (level === "hard") return { bg: "rgba(239,68,68,0.1)", color: "#f87171", border: "rgba(239,68,68,0.25)", label: "Hard" };
  return { bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "rgba(255,255,255,0.1)", label: "Non schedulato" };
}

function matchLevel(match: Match, health: MatchHealth | null) {
  if (!match.slot) return "unscheduled" as const;
  return (health?.level || "ok") as "ok" | "soft" | "hard";
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

function MatchCardDnd({ match, health, onToggleLock }: { match: Match; health: MatchHealth | null; onToggleLock: (m: Match) => void }) {
  const disabled = match.is_manually_locked;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: match.id, disabled });
  const level = matchLevel(match, health);
  const st = statusStyle(level);
  const gColor = match.gender?.toUpperCase() === "F" ? "#f472b6" : "#60a5fa";
  const gBg = match.gender?.toUpperCase() === "F" ? "rgba(236,72,153,0.12)" : "rgba(59,130,246,0.12)";
  const reasons = [...(health?.hard || []), ...(health?.soft || [])];

  return (
    <div
      id={`match-${match.id}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={reasons.length > 0 ? reasons.join(" · ") : "Nessuna violazione"}
      style={{
        transform: transform ? CSS.Translate.toString(transform) : undefined,
        opacity: isDragging ? 0.55 : 1,
        cursor: disabled ? "default" : "grab",
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : st.border}`,
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-semibold text-sm truncate" style={{ color: disabled ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.9)" }}>
          {match.team_home} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {match.team_away}
        </div>
        {disabled && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={2} style={{ flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ background: gBg, color: gColor }}>{match.gender?.toUpperCase()}</span>
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{match.group_name}</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{st.label}</span>
        <button className="text-xs px-2 py-0.5 rounded-full font-semibold transition-all duration-200" type="button" onClick={() => onToggleLock(match)}
          style={{ background: disabled ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.07)", color: disabled ? "#fb923c" : "rgba(255,255,255,0.5)" }}>
          {disabled ? "Unlock" : "Lock"}
        </button>
      </div>
    </div>
  );
}

function SlotRow({ slot, match, health, onToggleLock }: { slot: Slot; match: Match | null; health: MatchHealth | null; onToggleLock: (m: Match) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: slot.id });
  return (
    <div ref={setNodeRef} className="grid gap-3 rounded-xl p-2.5 transition-all duration-150"
      style={{ gridTemplateColumns: "72px 1fr", background: isOver ? "rgba(0,230,118,0.06)" : "rgba(255,255,255,0.02)", border: isOver ? "1px solid rgba(0,230,118,0.3)" : "1px solid rgba(255,255,255,0.05)" }}>
      <div className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
        {slot.start_time}
        <div style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400, fontSize: 10 }}>{slot.end_time}</div>
      </div>
      {match ? <MatchCardDnd match={match} health={health} onToggleLock={onToggleLock} /> : (
        <div className="flex items-center text-xs rounded-lg px-3" style={{ color: isOver ? "#00e676" : "rgba(255,255,255,0.2)", minHeight: 44 }}>
          {isOver ? "Rilascia qui" : "Slot libero"}
        </div>
      )}
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
  const [companionTids, setCompanionTids] = useState<string[]>([]);
  const [viewTab, setViewTab] = useState<"day" | "team" | "group">("day");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedPairKey, setSelectedPairKey] = useState<string>("");
  const [primaryGender, setPrimaryGender] = useState<"M" | "F">("M");
  const generateStartedAt = useRef<number>(0);

  const tournamentsQuery = useQuery({ queryKey: ["tournaments"], queryFn: () => tournamentApi.list() });
  const tournaments = (tournamentsQuery.data || []) as Tournament[];
  const pairs = useMemo(() => buildTournamentPairs(tournaments), [tournaments]);
  const selectedPair = useMemo(() => pairs.find((p) => p.key === selectedPairKey) ?? null, [pairs, selectedPairKey]);

  // Sync selectedPairKey with current tournament
  useEffect(() => {
    if (!pairs.length) { if (selectedPairKey) setSelectedPairKey(""); return; }
    if (selectedPairKey && pairs.some((p) => p.key === selectedPairKey)) return;
    const fromCurrent = current ? pairs.find((p) => p.male?.id === current.id || p.female?.id === current.id) : null;
    setSelectedPairKey((fromCurrent || pairs[0]).key);
  }, [current?.id, pairs, selectedPairKey]);

  // When pair or primaryGender changes, update current
  useEffect(() => {
    if (!selectedPair) return;
    const targetId = getTournamentIdForGender(selectedPair, primaryGender) || selectedPair.male?.id || selectedPair.female?.id || "";
    const t = tournaments.find((x) => x.id === targetId);
    if (t && current?.id !== t.id) { setCurrent(t); setCompanionTids([]); }
  }, [selectedPair, primaryGender, tournaments, current?.id, setCurrent]);

  const handleGenderChange = (g: "M" | "F") => {
    setPrimaryGender(g);
    setCompanionTids([]);
  };

  const tid = current?.id || "";
  const slotsQuery = useQuery({ queryKey: ["slots", tid], queryFn: () => tournamentApi.getSlots(tid), enabled: Boolean(tid) });
  const scheduleQuery = useQuery({ queryKey: ["schedule", tid], queryFn: () => tournamentApi.getSchedule(tid), enabled: Boolean(tid) });
  const scheduleStatusQuery = useQuery({ queryKey: ["schedule-status", tid], queryFn: () => tournamentApi.getScheduleStatus(tid), enabled: Boolean(tid), refetchInterval: 4000 });
  const qualityQuery = useQuery({ queryKey: ["schedule-quality", tid], queryFn: () => tournamentApi.getScheduleQuality(tid), enabled: Boolean(tid), refetchInterval: 2000 });

  useEffect(() => { if (scheduleQuery.data) setLocalSchedule(scheduleQuery.data as Match[]); }, [scheduleQuery.data]);
  useEffect(() => {
    const status = scheduleStatusQuery.data as { status?: string; result?: { objective?: number } } | undefined;
    if (!status?.status) return;
    // Ignore stale error/idle from previous solver for 2s after a new generate started
    const isStaleNegative = status.status === "error" || status.status === "idle";
    if (isStaleNegative && Date.now() - generateStartedAt.current < 2000) return;
    setSolverStatus(status.status);
    if (typeof status?.result?.objective === "number") setSolverObjective(status.result.objective);
  }, [scheduleStatusQuery.data]);

  useEffect(() => {
    if (!tid) return;
    const ws = new WebSocket(getWsUrl(tid));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type?: string; status?: string; objective?: number; message?: string };
        if (msg.type === "solution" && typeof msg.objective === "number") { setSolverObjective(msg.objective); setSolverStatus("running"); }
        if (msg.type === "done" && msg.status) setSolverStatus(msg.status);
        if (msg.type === "error") {
          setSolverStatus("error");
          setErrorMessage(`Errore solver: ${msg.message ?? "eccezione sconosciuta"}`);
        }
      } catch { /* no-op */ }
    };
    return () => ws.close();
  }, [tid]);

  useEffect(() => { setCompanionTids([]); }, [tid]);

  const generateMutation = useMutation({
    mutationFn: () => {
      generateStartedAt.current = Date.now();
      setSolverStatus("running");
      return tournamentApi.generateSchedule(tid, { companion_tournament_ids: companionTids.length > 0 ? companionTids : undefined });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["schedule-status", tid] }); },
    onError: () => { setSolverStatus("error"); },
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
  const matchById = useMemo(() => {
    const map = new Map<string, Match>();
    for (const m of scheduleData) map.set(m.id, m);
    return map;
  }, [scheduleData]);

  const bySlot = useMemo(() => {
    const map = new Map<string, Match>();
    scheduleData.forEach((m) => { if (m.slot?.id) map.set(m.slot.id, m); });
    return map;
  }, [scheduleData]);

  const unscheduled = scheduleData.filter((m) => !m.slot);
  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) { const list = grouped.get(slot.day_label) ?? []; list.push(slot); grouped.set(slot.day_label, list); }
    return [...grouped.entries()];
  }, [slots]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of scheduleData) { if (m.team_home_id) map.set(m.team_home_id, m.team_home); if (m.team_away_id) map.set(m.team_away_id, m.team_away); }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [scheduleData]);

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) setSelectedTeamId(teamOptions[0].id);
    if (selectedTeamId && !teamOptions.some((t) => t.id === selectedTeamId)) setSelectedTeamId(teamOptions[0]?.id || "");
  }, [selectedTeamId, teamOptions]);

  const teamMatches = useMemo(() => {
    if (!selectedTeamId) return [];
    return scheduleData.filter((m) => m.team_home_id === selectedTeamId || m.team_away_id === selectedTeamId).slice().sort(compareMatchTime);
  }, [scheduleData, selectedTeamId]);

  const groupOptions = useMemo(() =>
    [...new Set(scheduleData.map((m) => m.group_name))].filter(Boolean).sort((a, b) => a.localeCompare(b, "it")),
    [scheduleData]);

  useEffect(() => {
    if (!selectedGroup && groupOptions.length > 0) setSelectedGroup(groupOptions[0]);
    if (selectedGroup && !groupOptions.includes(selectedGroup)) setSelectedGroup(groupOptions[0] || "");
  }, [groupOptions, selectedGroup]);

  const groupMatches = useMemo(() => {
    if (!selectedGroup) return [];
    return scheduleData.filter((m) => m.group_name === selectedGroup).slice().sort(compareMatchTime);
  }, [scheduleData, selectedGroup]);

  const onToggleLock = async (match: Match) => {
    setErrorMessage(null);
    const previous = localSchedule ? [...localSchedule] : null;
    setLocalSchedule((curr) => (curr || []).map((item) => item.id === match.id ? { ...item, is_manually_locked: !item.is_manually_locked } : item));
    try { await lockMutation.mutateAsync({ mid: match.id, locked: !match.is_manually_locked }); }
    catch (error: unknown) { if (previous) setLocalSchedule(previous); setErrorMessage(error instanceof Error ? error.message : "Errore lock/unlock."); }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setErrorMessage(null);
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const match = scheduleData.find((item) => item.id === activeId);
    if (!match) return;
    if (match.is_manually_locked) { setErrorMessage("Partita bloccata: fai unlock prima di spostarla."); return; }
    const targetOccupiedBy = scheduleData.find((item) => item.slot?.id === overId && item.id !== activeId);
    if (targetOccupiedBy) { setErrorMessage("Slot occupato. Seleziona uno slot libero."); return; }
    const targetSlot = slots.find((s) => s.id === overId);
    if (!targetSlot) return;
    const previous = scheduleData.map((item) => ({ ...item, slot: item.slot ? { ...item.slot } : null }));
    setLocalSchedule((curr) => (curr || []).map((item) => item.id === activeId ? { ...item, slot: { id: targetSlot.id, start_time: targetSlot.start_time, end_time: targetSlot.end_time, day_label: targetSlot.day_label } } : item));
    try { await patchSlotMutation.mutateAsync({ mid: activeId, slotId: overId }); }
    catch (error: unknown) { setLocalSchedule(previous); setErrorMessage(error instanceof Error ? error.message : "Errore nello spostamento partita."); }
  };

  const solverColor = solverStatus === "running" ? "#3b82f6" : solverStatus === "done" || solverStatus === "optimal" ? "#00e676" : solverStatus === "error" || solverStatus === "infeasible" ? "#ef4444" : "rgba(255,255,255,0.3)";

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>Pianificazione</div>
        <h1 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800 }}>Calendario</h1>
        <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Vista Giorno, Squadra e Girone con drag & drop e controllo violazioni.</p>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

      {/* Controls */}
      <div className="sport-card p-5 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Edizione</span>
            <select className="sport-select min-w-52" value={selectedPairKey}
              onChange={(e) => setSelectedPairKey(e.target.value)}>
              {pairs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Sezione principale</span>
            <div className="flex gap-2">
              {(["M", "F"] as const).map((g) => {
                const available = Boolean(g === "M" ? selectedPair?.male : selectedPair?.female);
                const isActive = primaryGender === g;
                const color = g === "M" ? "#60a5fa" : "#f472b6";
                return (
                  <button key={g} type="button" onClick={() => handleGenderChange(g)} disabled={!available}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                    style={isActive
                      ? { background: `${color}20`, color, border: `1px solid ${color}55` }
                      : { background: "rgba(255,255,255,0.04)", color: available ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.08)", cursor: available ? "pointer" : "not-allowed" }}>
                    {g === "M" ? "Maschile" : "Femminile"}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedPair && (() => {
            const otherId = primaryGender === "M" ? selectedPair.female?.id : selectedPair.male?.id;
            const otherLabel = primaryGender === "M" ? "Femminile" : "Maschile";
            if (!otherId) return null;
            const isChecked = companionTids.includes(otherId);
            return (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Pianifica insieme a</span>
                <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-xl transition-all duration-200"
                  style={isChecked
                    ? { background: "rgba(0,230,118,0.1)", color: "#00e676", border: "1px solid rgba(0,230,118,0.25)" }
                    : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <input type="checkbox" className="hidden" checked={isChecked}
                    onChange={(e) => setCompanionTids(e.target.checked ? [otherId] : [])} />
                  {isChecked ? "✓" : ""} Sezione {otherLabel}
                </label>
              </div>
            );
          })()}

          <button className="sport-btn-primary" type="button" onClick={() => void generateMutation.mutateAsync()} disabled={!tid || generateMutation.isPending}>
            {generateMutation.isPending ? "Generazione..." : "Genera calendario"}
          </button>
          <button className="sport-btn-secondary" type="button" onClick={() => void applyMutation.mutateAsync()} disabled={!tid || applyMutation.isPending}>
            {applyMutation.isPending ? "Applicazione..." : "Applica soluzione"}
          </button>
          <button className="sport-btn-secondary" type="button" disabled={!tid}
            onClick={() => { void queryClient.invalidateQueries({ queryKey: ["schedule", tid] }); void queryClient.invalidateQueries({ queryKey: ["slots", tid] }); void queryClient.invalidateQueries({ queryKey: ["schedule-status", tid] }); void queryClient.invalidateQueries({ queryKey: ["schedule-quality", tid] }); }}>
            Refresh
          </button>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: solverColor, boxShadow: `0 0 6px ${solverColor}`, animation: solverStatus === "running" ? "liveDot 1.4s ease-in-out infinite" : "none" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: solverColor }}>{solverStatus}</span>
            {solverObjective !== null && <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>obj {solverObjective}</span>}
          </div>
        </div>

        {quality && (() => {
          const unscheduled = quality.unscheduled_matches ?? (quality.total_matches - quality.scheduled_matches);
          const realHard = Math.max(0, (quality.hard_violations ?? 0) - unscheduled);
          const kpis = [
            { label: "Pianificate", value: `${quality.scheduled_matches} / ${quality.total_matches}`, color: quality.scheduled_matches === quality.total_matches ? "#00e676" : "#f59e0b" },
            { label: "Non pianificate", value: String(unscheduled), color: unscheduled > 0 ? "#f59e0b" : "#00e676" },
            { label: "Hard viol.", value: String(realHard), color: realHard > 0 ? "#f87171" : "#00e676", title: "Violazioni di vincolo sulle partite già pianificate (escluse non pianificate)" },
            { label: "Soft viol.", value: String(quality.soft_violations ?? 0), color: (quality.soft_violations ?? 0) > 0 ? "#f59e0b" : "#00e676" },
            { label: "Preferenze", value: `${quality.preferences_respected_pct ?? quality.coverage_pct}%`, color: "#3b82f6" },
          ];
          return (
          <>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {kpis.map(({ label, value, color, title }) => (
                <div key={label} className="rounded-xl px-3 py-2 flex items-center justify-between" title={title}
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ fontFamily: "Rajdhani, sans-serif", color }}>{value}</span>
                </div>
              ))}
            </div>

            {(quality.alerts || []).length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                <button type="button" onClick={() => setAlertsOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 transition-colors duration-150"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex items-center gap-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth={2} strokeLinecap="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>Dettaglio violazioni</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                      {(quality.alerts || []).filter(a => a.severity === "hard").length} hard
                    </span>
                    {(quality.alerts || []).filter(a => a.severity === "soft").length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                        {(quality.alerts || []).filter(a => a.severity === "soft").length} soft
                      </span>
                    )}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2}
                    style={{ transform: alertsOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {alertsOpen && (
                  <div className="divide-y" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    {(quality.alerts || []).map((alert, idx) => {
                      const match = matchById.get(alert.match_id);
                      const isHard = alert.severity === "hard";
                      const accentColor = isHard ? "#f87171" : "#f59e0b";
                      const accentBg = isHard ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)";
                      return (
                        <div key={idx} className="px-4 py-3 flex gap-3" style={{ background: accentBg, borderColor: "rgba(255,255,255,0.04)" }}>
                          <div className="w-1 rounded-full flex-shrink-0 mt-0.5 self-stretch" style={{ background: accentColor, minHeight: 16 }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                                style={{ background: isHard ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)", color: accentColor }}>
                                {isHard ? "HARD" : "SOFT"}
                              </span>
                              {match && (
                                <span className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>
                                  {match.team_home} <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>vs</span> {match.team_away}
                                </span>
                              )}
                              {match?.slot && (
                                <span className="text-xs ml-auto flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>
                                  {match.slot.day_label} · {match.slot.start_time}
                                </span>
                              )}
                            </div>
                            <ul className="space-y-0.5">
                              {(alert.reasons || [alert.message]).map((r, ri) => (
                                <li key={ri} className="text-xs flex items-start gap-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                                  <span style={{ color: accentColor, flexShrink: 0 }}>›</span>
                                  {translateReason(r)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
          );
        })()}
      </div>

      {/* View tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["day", "team", "group"] as const).map((key) => {
          const labels = { day: "Vista Giorno", team: "Vista Squadra", group: "Vista Girone" };
          return (
            <button key={key} type="button" onClick={() => setViewTab(key)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
              style={viewTab === key
                ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
                : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {labels[key]}
            </button>
          );
        })}
      </div>

      {/* Day view */}
      {viewTab === "day" && (
        <DndContext onDragEnd={(event) => void onDragEnd(event)}>
          <div className="space-y-5">
            {unscheduled.length > 0 && (
              <div className="sport-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 18, fontWeight: 700 }}>Partite non schedulate</h2>
                  <span className="sport-badge-orange">{unscheduled.length}</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {unscheduled.map((match) => <MatchCardDnd key={match.id} match={match} health={healthMap[match.id] || null} onToggleLock={onToggleLock} />)}
                </div>
              </div>
            )}
            {slotsByDay.length === 0 ? (
              <div className="sport-card p-8 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>Nessuno slot configurato.</div>
            ) : slotsByDay.map(([dayLabel, daySlots]) => (
              <div key={dayLabel} className="sport-card overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: "#00e676", boxShadow: "0 0 6px #00e676" }} />
                  <h3 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{dayLabel}</h3>
                  <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {daySlots.filter((s) => bySlot.has(s.id)).length} / {daySlots.length} slot occupati
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {daySlots.map((slot) => {
                    const match = bySlot.get(slot.id) || null;
                    return <SlotRow key={slot.id} slot={slot} match={match} health={match ? healthMap[match.id] || null : null} onToggleLock={onToggleLock} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </DndContext>
      )}

      {/* Team view */}
      {viewTab === "team" && (
        <div className="sport-card p-5 space-y-4">
          {teamOptions.length === 0 ? (
            <div className="text-center py-6" style={{ color: "rgba(255,255,255,0.35)" }}>Nessuna squadra disponibile.</div>
          ) : (
            <>
              <div className="flex flex-col gap-1 max-w-xs">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Seleziona squadra</span>
                <select className="sport-select" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
                  {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                {teamMatches.length === 0 ? (
                  <div className="text-sm text-center py-4" style={{ color: "rgba(255,255,255,0.35)" }}>Nessuna partita per questa squadra.</div>
                ) : teamMatches.map((match) => {
                  const level = matchLevel(match, healthMap[match.id] || null);
                  const st = statusStyle(level);
                  const gColor = match.gender?.toUpperCase() === "F" ? "#f472b6" : "#60a5fa";
                  const gBg = match.gender?.toUpperCase() === "F" ? "rgba(236,72,153,0.12)" : "rgba(59,130,246,0.12)";
                  return (
                    <div key={match.id} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="font-semibold text-sm">{match.team_home} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {match.team_away}</div>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: gBg, color: gColor }}>{match.gender?.toUpperCase()}</span>
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{match.slot ? `${match.slot.day_label} · ${match.slot.start_time}` : "Non schedulata"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Group view */}
      {viewTab === "group" && (
        <div className="sport-card p-5 space-y-4">
          {groupOptions.length === 0 ? (
            <div className="text-center py-6" style={{ color: "rgba(255,255,255,0.35)" }}>Nessun girone disponibile.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {groupOptions.map((name) => (
                  <button key={name} type="button" onClick={() => setSelectedGroup(name)}
                    className="px-3 py-2 text-sm font-semibold rounded-xl transition-all duration-200"
                    style={selectedGroup === name
                      ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    {name}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <table className="sport-table min-w-full">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                      {["MATCH", "GIORNO / ORA", "STATO"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupMatches.map((match) => {
                      const level = matchLevel(match, healthMap[match.id] || null);
                      const st = statusStyle(level);
                      return (
                        <tr key={match.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td className="px-4 py-3 font-medium text-sm">{match.team_home} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {match.team_away}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{match.slot ? `${match.slot.day_label} · ${match.slot.start_time}` : "—"}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{st.label}</span>
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
      )}
    </div>
  );
}
