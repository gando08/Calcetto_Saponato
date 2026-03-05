import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { matchApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match, MatchGoal, Scorer, StandingRow, Tournament } from "../types/index";
import { buildTournamentPairs, getTournamentIdForGender } from "../utils/tournamentPairs";

type ResultDraft = {
  goals_home: number;
  goals_away: number;
  yellow_home: number;
  yellow_away: number;
};

const EMPTY_RESULT: ResultDraft = { goals_home: 0, goals_away: 0, yellow_home: 0, yellow_away: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

function rankStyle(index: number) {
  if (index === 0) return { bg: "rgba(245,158,11,0.08)", color: "#f59e0b", medal: "🥇" };
  if (index === 1) return { bg: "rgba(148,163,184,0.06)", color: "#94a3b8", medal: "🥈" };
  if (index === 2) return { bg: "rgba(180,83,9,0.06)", color: "#b45309", medal: "🥉" };
  return { bg: "transparent", color: "rgba(255,255,255,0.45)", medal: "" };
}

function GoalDiffBadge({ diff }: { diff: number }) {
  if (diff > 0) return <span className="sport-badge-neon tabular-nums">+{diff}</span>;
  if (diff < 0) return <span className="sport-badge-red tabular-nums">{diff}</span>;
  return <span className="sport-badge-gray tabular-nums">0</span>;
}

// ── Merge scorers modal ────────────────────────────────────────────────────

type MergeModalProps = {
  tid: string;
  scorers: Scorer[];
  onClose: () => void;
};

function MergeModal({ tid, scorers, onClose }: MergeModalProps) {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [canonicalName, setCanonicalName] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Group scorers by team
  const teamMap = useMemo(() => {
    const map = new Map<string, { teamName: string; names: string[] }>();
    for (const s of scorers) {
      if (!s.team_id) continue;
      const entry = map.get(s.team_id) ?? { teamName: s.team, names: [] };
      entry.names.push(s.player);
      map.set(s.team_id, entry);
    }
    return map;
  }, [scorers]);

  const teamOptions = useMemo(() =>
    [...teamMap.entries()].map(([id, { teamName }]) => ({ id, name: teamName }))
      .sort((a, b) => a.name.localeCompare(b.name, "it")),
    [teamMap]
  );

  const namesForTeam = useMemo(
    () => teamMap.get(selectedTeamId)?.names || [],
    [teamMap, selectedTeamId]
  );

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) setSelectedTeamId(teamOptions[0].id);
  }, [teamOptions, selectedTeamId]);

  // Reset selection when team changes
  useEffect(() => {
    setSelectedNames(new Set());
    setCanonicalName("");
    setSuccessMsg(null);
    setErrorMsg(null);
  }, [selectedTeamId]);

  const mergeMutation = useMutation({
    mutationFn: (data: { team_id: string; canonical_name: string; aliases: string[] }) =>
      tournamentApi.mergeScorers(tid, data),
    onSuccess: (res: { updated: number; canonical_name: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["scorers"] });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
      setSuccessMsg(`✓ ${res.updated} gol rinominati → "${res.canonical_name}"`);
      setSelectedNames(new Set());
      setCanonicalName("");
    },
    onError: () => {
      setErrorMsg("Errore durante l'unificazione. Riprova.");
    },
  });

  const toggleName = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleMerge = () => {
    if (!selectedTeamId || selectedNames.size < 1 || !canonicalName.trim()) return;
    setSuccessMsg(null);
    setErrorMsg(null);
    mergeMutation.mutate({
      team_id: selectedTeamId,
      canonical_name: canonicalName.trim(),
      aliases: [...selectedNames],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}>

        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#a78bfa" }}>
              Classifica Marcatori
            </div>
            <h3 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 22, fontWeight: 800 }}>
              Unifica alias
            </h3>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              Seleziona i nomi da accorpare, inserisci il nome corretto e conferma.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Team selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
              Squadra
            </label>
            <select className="sport-select" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Names for the team */}
          {namesForTeam.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
              Nessun marcatore per questa squadra.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
                Nomi registrati — seleziona quelli da unificare
              </label>
              <div className="space-y-1.5 rounded-xl p-3"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                {namesForTeam.map((name) => {
                  const selected = selectedNames.has(name);
                  return (
                    <button key={name} type="button" onClick={() => toggleName(name)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150"
                      style={{
                        background: selected ? "rgba(167,139,250,0.1)" : "rgba(255,255,255,0.03)",
                        border: selected ? "1px solid rgba(167,139,250,0.35)" : "1px solid transparent",
                      }}>
                      <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{
                          background: selected ? "#a78bfa" : "rgba(255,255,255,0.08)",
                          border: selected ? "none" : "1px solid rgba(255,255,255,0.15)",
                        }}>
                        {selected && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={3}>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </span>
                      <span className="text-sm font-medium flex-1"
                        style={{ color: selected ? "#d8b4fe" : "rgba(255,255,255,0.75)" }}>
                        {name}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {scorers.find((s) => s.player === name && s.team_id === selectedTeamId)?.goals ?? "?"} gol
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Canonical name input */}
          {selectedNames.size > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
                Nome corretto (risultante)
              </label>
              <input
                type="text"
                className="sport-input-sm w-full"
                style={{ fontSize: 14, padding: "10px 14px" }}
                placeholder="es. Mario Rossi"
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleMerge(); }}
                autoFocus
              />
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                Tutti i {selectedNames.size} nome/i selezionati verranno rinominati in questo.
              </p>
            </div>
          )}

          {/* Feedback */}
          {successMsg && (
            <div className="rounded-xl px-4 py-3 text-sm font-semibold"
              style={{ background: "rgba(0,230,118,0.1)", color: "#00e676", border: "1px solid rgba(0,230,118,0.2)" }}>
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button type="button" onClick={onClose} className="sport-btn-secondary text-sm">
            Chiudi
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={selectedNames.size < 1 || !canonicalName.trim() || mergeMutation.isPending}
            className="text-sm px-5 py-2.5 rounded-xl font-semibold transition-all duration-200"
            style={{
              background: selectedNames.size >= 1 && canonicalName.trim() ? "rgba(167,139,250,0.2)" : "rgba(255,255,255,0.05)",
              color: selectedNames.size >= 1 && canonicalName.trim() ? "#a78bfa" : "rgba(255,255,255,0.3)",
              border: selectedNames.size >= 1 && canonicalName.trim() ? "1px solid rgba(167,139,250,0.35)" : "1px solid rgba(255,255,255,0.08)",
              cursor: selectedNames.size >= 1 && canonicalName.trim() ? "pointer" : "not-allowed",
            }}
          >
            {mergeMutation.isPending ? "Unificazione..." : `⟳ Unifica (${selectedNames.size} selezionati)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Marcatori panel (collapsible per match) ────────────────────────────────

function GoalsPanel({
  match,
  onGoalAdded,
  onGoalDeleted,
}: {
  match: Match;
  onGoalAdded?: (attributedTeamId: string) => void;
  onGoalDeleted?: (goal: MatchGoal) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [newPlayer, setNewPlayer] = useState("");
  const [scoringTeamId, setScoringTeamId] = useState<string>("");
  const [isOwnGoal, setIsOwnGoal] = useState(false);

  const homeId = match.team_home_id || "";
  const awayId = match.team_away_id || "";

  useEffect(() => {
    if (!scoringTeamId && homeId) setScoringTeamId(homeId);
  }, [homeId, scoringTeamId]);

  const goalsQuery = useQuery({
    queryKey: ["goals", match.id],
    queryFn: () => matchApi.listGoals(match.id) as Promise<MatchGoal[]>,
    enabled: expanded,
    refetchInterval: expanded ? 15000 : false,
  });

  const addGoalMutation = useMutation({
    mutationFn: (data: { player_name: string; is_own_goal: boolean; attributed_to_team_id: string }) =>
      matchApi.addGoal(match.id, data),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["goals", match.id] });
      void queryClient.invalidateQueries({ queryKey: ["scorers"] });
      setNewPlayer("");
      setIsOwnGoal(false);
      onGoalAdded?.(variables.attributed_to_team_id);
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (goal: MatchGoal) => matchApi.deleteGoal(goal.id),
    onSuccess: (_, deletedGoal) => {
      void queryClient.invalidateQueries({ queryKey: ["goals", match.id] });
      void queryClient.invalidateQueries({ queryKey: ["scorers"] });
      onGoalDeleted?.(deletedGoal);
    },
  });

  const goals = (goalsQuery.data || []) as MatchGoal[];
  const getTeamName = (tid: string) =>
    tid === homeId ? match.team_home : tid === awayId ? match.team_away : "?";
  const isHomeTeam = (tid: string) => tid === homeId;

  const handleAdd = () => {
    if (!newPlayer.trim() || !scoringTeamId) return;
    const attributed = isOwnGoal
      ? scoringTeamId === homeId ? awayId : homeId
      : scoringTeamId;
    addGoalMutation.mutate({
      player_name: newPlayer.trim(),
      is_own_goal: isOwnGoal,
      attributed_to_team_id: attributed,
    });
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <button type="button" onClick={() => setExpanded((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
        style={{ color: goals.length > 0 || expanded ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.35)" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <span className="text-xs font-semibold">Marcatori</span>
        {goals.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: "rgba(0,230,118,0.12)", color: "#00e676" }}>
            {goals.length}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          style={{ marginLeft: "auto", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {goalsQuery.isLoading && (
            <div className="text-xs text-center py-2" style={{ color: "rgba(255,255,255,0.3)" }}>Caricamento...</div>
          )}
          {!goalsQuery.isLoading && goals.length === 0 && (
            <div className="text-xs text-center py-2" style={{ color: "rgba(255,255,255,0.3)" }}>Nessun marcatore registrato</div>
          )}
          {goals.map((goal) => {
            const teamName = getTeamName(goal.attributed_to_team_id);
            const gColor = isHomeTeam(goal.attributed_to_team_id) ? "#60a5fa" : "#f472b6";
            return (
              <div key={goal.id} className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="text-sm">⚽</span>
                <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: "rgba(255,255,255,0.85)" }}>
                  {goal.player_name}
                  {goal.is_own_goal && (
                    <span className="ml-1.5 text-xs font-normal" style={{ color: "#f59e0b" }}>aut.</span>
                  )}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                  style={{ background: `${gColor}18`, color: gColor }}>
                  {teamName}
                </span>
                <button type="button" onClick={() => deleteGoalMutation.mutate(goal)}
                  disabled={deleteGoalMutation.isPending}
                  className="rounded-lg p-1 transition-colors flex-shrink-0"
                  style={{ color: "rgba(255,255,255,0.3)" }} title="Rimuovi marcatore">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Add goal form */}
          <div className="flex items-center gap-2 flex-wrap rounded-xl p-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <input type="text" className="sport-input-sm" style={{ flex: "1 1 120px", minWidth: 100 }}
              placeholder="Nome giocatore"
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
            <select className="sport-select" style={{ fontSize: 12, padding: "6px 10px", flex: "1 1 90px", minWidth: 80 }}
              value={scoringTeamId} onChange={(e) => setScoringTeamId(e.target.value)}>
              {homeId && <option value={homeId}>{match.team_home}</option>}
              {awayId && <option value={awayId}>{match.team_away}</option>}
            </select>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer flex-shrink-0"
              style={{ color: isOwnGoal ? "#f59e0b" : "rgba(255,255,255,0.4)" }}>
              <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: isOwnGoal ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.07)", border: isOwnGoal ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.15)" }}>
                {isOwnGoal && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={3}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </span>
              <input type="checkbox" checked={isOwnGoal} onChange={(e) => setIsOwnGoal(e.target.checked)} className="sr-only" />
              Aut.
            </label>
            <button type="button" onClick={handleAdd}
              disabled={!newPlayer.trim() || !scoringTeamId || addGoalMutation.isPending}
              className="sport-btn-primary flex-shrink-0" style={{ padding: "6px 14px", fontSize: 12 }}>
              + Aggiungi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Results component ─────────────────────────────────────────────────

export function Results() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [gender, setGender] = useState<"M" | "F">("M");
  const [selectedPairKey, setSelectedPairKey] = useState<string>("");
  const [groupTab, setGroupTab] = useState<string>("");
  const [viewTab, setViewTab] = useState<"group" | "team" | "day">("group");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});
  const resultDraftsRef = useRef(resultDrafts);
  useEffect(() => { resultDraftsRef.current = resultDrafts; }, [resultDrafts]);
  const [showMerge, setShowMerge] = useState(false);

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

  // When pair or gender changes, update current to the matching tournament
  useEffect(() => {
    if (!selectedPair) return;
    const targetId = getTournamentIdForGender(selectedPair, gender) || selectedPair.male?.id || selectedPair.female?.id || "";
    const t = tournaments.find((x) => x.id === targetId);
    if (t && current?.id !== t.id) setCurrent(t);
  }, [selectedPair, gender, tournaments, current?.id, setCurrent]);

  const handleGenderChange = (g: "M" | "F") => {
    setGender(g);
    setGroupTab("");
    if (!selectedPair) return;
    const targetId = getTournamentIdForGender(selectedPair, g);
    if (!targetId) return;
    const t = tournaments.find((x) => x.id === targetId);
    if (t) setCurrent(t);
  };

  const tid = current?.id || "";
  const scheduleQuery = useQuery({
    queryKey: ["schedule", tid],
    queryFn: () => tournamentApi.getSchedule(tid),
    enabled: Boolean(tid),
    refetchInterval: 20000,
  });
  const standingsQuery = useQuery({
    queryKey: ["standings", tid, gender],
    queryFn: () => tournamentApi.getStandings(tid, gender),
    enabled: Boolean(tid),
    refetchInterval: 15000,
  });
  const scorersQuery = useQuery({
    queryKey: ["scorers", tid, gender],
    queryFn: () => tournamentApi.getScorers(tid, gender),
    enabled: Boolean(tid),
    refetchInterval: 10000,
  });

  const setResultMutation = useMutation({
    mutationFn: ({ matchId, payload }: { matchId: string; payload: ResultDraft }) => matchApi.setResult(matchId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      await queryClient.invalidateQueries({ queryKey: ["standings", tid, gender] });
    },
  });

  const standingsBlocks = ((standingsQuery.data || []) as Array<{ group: string; standings: StandingRow[] }>).slice();
  const groupNames = useMemo(() => standingsBlocks.map((b) => b.group), [standingsBlocks]);

  useEffect(() => {
    if (groupNames.length === 0) { setGroupTab(""); return; }
    if (!groupTab || (!groupNames.includes(groupTab) && groupTab !== "wildcard")) setGroupTab(groupNames[0]);
  }, [groupNames, groupTab]);

  const selectedStandings = useMemo(() => {
    if (groupTab === "wildcard") {
      const candidates: StandingRow[] = [];
      for (const block of standingsBlocks) {
        if (block.standings.length > 1) candidates.push(block.standings[1]);
      }
      return candidates.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
        return b.goals_for - a.goals_for;
      });
    }
    return standingsBlocks.find((b) => b.group === groupTab)?.standings || [];
  }, [groupTab, standingsBlocks]);

  // All gender-filtered matches
  const allGenderMatches = useMemo(() => {
    const all = (scheduleQuery.data || []) as Match[];
    return all.filter((m) => (m.gender || "").toUpperCase() === gender);
  }, [gender, scheduleQuery.data]);

  // Team options derived from matches
  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allGenderMatches) {
      if (m.team_home_id) map.set(m.team_home_id, m.team_home);
      if (m.team_away_id) map.set(m.team_away_id, m.team_away);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [allGenderMatches]);

  // Day options derived from matches
  const dayOptions = useMemo(() => {
    const days = new Set<string>();
    for (const m of allGenderMatches) { if (m.slot?.day_label) days.add(m.slot.day_label); }
    return [...days].sort((a, b) => a.localeCompare(b, "it"));
  }, [allGenderMatches]);

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) setSelectedTeamId(teamOptions[0].id);
    if (selectedTeamId && !teamOptions.some((t) => t.id === selectedTeamId)) setSelectedTeamId(teamOptions[0]?.id || "");
  }, [teamOptions, selectedTeamId]);

  useEffect(() => {
    if (!selectedDay && dayOptions.length > 0) setSelectedDay(dayOptions[0]);
    if (selectedDay && !dayOptions.includes(selectedDay)) setSelectedDay(dayOptions[0] || "");
  }, [dayOptions, selectedDay]);

  const matches = useMemo(() => {
    if (viewTab === "team") {
      return allGenderMatches.filter((m) => m.team_home_id === selectedTeamId || m.team_away_id === selectedTeamId);
    }
    if (viewTab === "day") {
      return allGenderMatches.filter((m) => m.slot?.day_label === selectedDay);
    }
    if (!groupTab || groupTab === "wildcard") return allGenderMatches;
    return allGenderMatches.filter((m) => m.group_name === groupTab);
  }, [viewTab, groupTab, selectedTeamId, selectedDay, allGenderMatches]);

  useEffect(() => {
    setResultDrafts((curr) => {
      const next = { ...curr };
      for (const match of matches) {
        if (!next[match.id]) {
          next[match.id] = match.result
            ? { goals_home: match.result.goals_home, goals_away: match.result.goals_away, yellow_home: match.result.yellow_home, yellow_away: match.result.yellow_away }
            : { ...EMPTY_RESULT };
        }
      }
      return next;
    });
  }, [matches]);

  const updateDraft = (matchId: string, key: keyof ResultDraft, value: number) => {
    setResultDrafts((curr) => ({ ...curr, [matchId]: { ...(curr[matchId] || EMPTY_RESULT), [key]: value } }));
  };

  const resetFouls = (matchId: string) => {
    setResultDrafts((curr) => ({ ...curr, [matchId]: { ...(curr[matchId] || EMPTY_RESULT), yellow_home: 0, yellow_away: 0 } }));
  };

  const saveResult = async (matchId: string) => {
    setErrorMessage(null);
    try {
      await setResultMutation.mutateAsync({ matchId, payload: resultDrafts[matchId] || EMPTY_RESULT });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore salvataggio risultato.");
    }
  };

  const handleGoalAdded = useCallback((matchId: string, homeId: string, attributedTeamId: string) => {
    const current = resultDraftsRef.current[matchId] || EMPTY_RESULT;
    const isHome = attributedTeamId === homeId;
    const updated: ResultDraft = {
      ...current,
      goals_home: isHome ? current.goals_home + 1 : current.goals_home,
      goals_away: !isHome ? current.goals_away + 1 : current.goals_away,
    };
    setResultDrafts((prev) => ({ ...prev, [matchId]: updated }));
    void matchApi.setResult(matchId, updated).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      void queryClient.invalidateQueries({ queryKey: ["standings", tid, gender] });
    });
  }, [tid, gender, queryClient]);

  const handleGoalDeleted = useCallback((matchId: string, homeId: string, goal: MatchGoal) => {
    const current = resultDraftsRef.current[matchId] || EMPTY_RESULT;
    const isHome = goal.attributed_to_team_id === homeId;
    const updated: ResultDraft = {
      ...current,
      goals_home: isHome ? Math.max(0, current.goals_home - 1) : current.goals_home,
      goals_away: !isHome ? Math.max(0, current.goals_away - 1) : current.goals_away,
    };
    setResultDrafts((prev) => ({ ...prev, [matchId]: updated }));
    void matchApi.setResult(matchId, updated).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["schedule", tid] });
      void queryClient.invalidateQueries({ queryKey: ["standings", tid, gender] });
    });
  }, [tid, gender, queryClient]);

  const scorers = (scorersQuery.data || []) as Scorer[];
  const maxPoints = selectedStandings.reduce((max, row) => Math.max(max, row.points), 1);

  const genderActiveStyle = (g: "M" | "F") =>
    gender === g
      ? g === "M"
        ? { background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.35)" }
        : { background: "rgba(236,72,153,0.15)", color: "#f472b6", border: "1px solid rgba(236,72,153,0.35)" }
      : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" };

  const viewTabStyle = (tab: "group" | "team" | "day") =>
    viewTab === tab
      ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
      : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>Competizione</div>
        <h1 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800 }}>
          Risultati & Classifiche
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
          Gestione risultati inline con classifiche aggiornate in tempo reale.
        </p>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

      {/* Controls */}
      <div className="sport-card p-5 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Edizione</span>
          <select className="sport-select min-w-52" value={selectedPairKey}
            onChange={(e) => setSelectedPairKey(e.target.value)}>
            {pairs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          {(["M", "F"] as const).map((g) => (
            <button key={g} type="button" onClick={() => handleGenderChange(g)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
              style={genderActiveStyle(g)}>
              {g === "M" ? "Maschile" : "Femminile"}
            </button>
          ))}
        </div>

        {/* Group tabs for standings navigation */}
        <div className="flex flex-wrap gap-2">
          {groupNames.map((name) => (
            <button key={name} type="button" onClick={() => { setGroupTab(name); setViewTab("group"); }}
              className="px-3 py-2 text-sm font-semibold rounded-xl transition-all duration-200"
              style={groupTab === name && viewTab === "group"
                ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
                : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {name}
            </button>
          ))}
          <button type="button" onClick={() => { setGroupTab("wildcard"); setViewTab("group"); }}
            className="px-3 py-2 text-sm font-semibold rounded-xl transition-all duration-200"
            style={groupTab === "wildcard" && viewTab === "group"
              ? { background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }
              : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.07)" }}>
            Wild Card
          </button>
        </div>
      </div>

      {/* Standings table */}
      <div className="sport-card overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "20px", fontWeight: 700 }}>
            {groupTab === "wildcard" ? "Classifica Wild Card" : `Classifica ${groupTab || ""}`}
          </h2>
        </div>

        {selectedStandings.length === 0 ? (
          <div className="p-8 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
            <div className="text-2xl mb-2">📊</div>
            <div>Nessuna classifica disponibile.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="sport-table min-w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {["#", "SQUADRA", "G", "V", "P", "S", "GF", "GS", "DR", "PT", "PUNTI"].map((h) => (
                    <th key={h} className={`px-${h === "SQUADRA" || h === "PUNTI" ? "4" : "3"} py-3 ${h === "SQUADRA" || h === "#" || h === "PUNTI" ? "text-left" : "text-center"}`}
                      style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", minWidth: h === "PUNTI" ? 120 : undefined }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedStandings.map((row, index) => {
                  const { bg, color, medal } = rankStyle(index);
                  const pointsPct = maxPoints > 0 ? (row.points / maxPoints) * 100 : 0;
                  const progressColor = index === 0 ? "#f59e0b" : index === 1 ? "#94a3b8" : index === 2 ? "#b45309" : "#3b82f6";
                  return (
                    <tr key={`${row.team}-${index}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: bg }}>
                      <td className="px-4 py-3">
                        <span style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: index < 3 ? 16 : 13, background: index < 3 ? `${color}20` : "transparent", color: index < 3 ? color : "rgba(255,255,255,0.35)" }}>
                          {medal || index + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-sm">{row.team_name}</td>
                      <td className="px-3 py-3 text-center text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{row.played}</td>
                      <td className="px-3 py-3 text-center text-sm font-semibold" style={{ color: "#00e676" }}>{row.won}</td>
                      <td className="px-3 py-3 text-center text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>{row.drawn}</td>
                      <td className="px-3 py-3 text-center text-sm" style={{ color: "#f87171" }}>{row.lost}</td>
                      <td className="px-3 py-3 text-center text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{row.goals_for}</td>
                      <td className="px-3 py-3 text-center text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{row.goals_against}</td>
                      <td className="px-3 py-3 text-center"><GoalDiffBadge diff={row.goal_diff} /></td>
                      <td className="px-4 py-3 text-center">
                        <span style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 20, fontWeight: 700, color: index < 3 ? color : "#ffffff" }}>{row.points}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 99, height: 6, minWidth: 80 }}>
                          <div style={{ width: `${pointsPct}%`, background: progressColor, height: "100%", borderRadius: 99, transition: "width 0.7s ease-out" }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scorers ranking */}
      {scorers.length > 0 && (
        <div className="sport-card overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "20px", fontWeight: 700 }}>Classifica Marcatori</h2>
            <span className="sport-badge-orange">{scorers.length}</span>
            {scorersQuery.isFetching && (
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>⟳ live</span>
            )}
            <button type="button" onClick={() => setShowMerge(true)}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg font-semibold transition-all duration-200"
              style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>
              ⟳ Unifica alias
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="sport-table min-w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {[["#", "px-4 text-left"], ["GIOCATORE", "px-4 text-left"], ["SQUADRA", "px-4 text-left"], ["GOL", "px-4 text-right"]].map(([h, cls]) => (
                    <th key={h} className={`${cls} py-3`} style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scorers.map((scorer, idx) => {
                  const { bg, color, medal } = rankStyle(idx);
                  return (
                    <tr key={`${scorer.player}-${scorer.team_id}-${idx}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: bg }}>
                      <td className="px-4 py-3">
                        <span style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: idx < 3 ? 16 : 13, background: idx < 3 ? `${color}20` : "transparent", color: idx < 3 ? color : "rgba(255,255,255,0.35)" }}>
                          {medal || idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-sm" style={{ color: "rgba(255,255,255,0.9)" }}>{scorer.player}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{scorer.team}</td>
                      <td className="px-4 py-3 text-right">
                        <span style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 20, fontWeight: 700, color: idx < 3 ? color : "#ffffff" }}>
                          {scorer.goals}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match result entry */}
      <div className="sport-card overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "20px", fontWeight: 700 }}>Inserimento risultati</h2>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
            Modifica inline · falli resettabili all'intervallo · marcatori per la classifica
          </p>
        </div>

        {/* View tab selector */}
        <div className="px-5 pt-4 pb-2 flex flex-wrap gap-3 items-center" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex gap-2">
            {([["group", "Girone"], ["team", "Squadra"], ["day", "Giorno"]] as const).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setViewTab(tab)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200"
                style={viewTabStyle(tab)}>
                {label}
              </button>
            ))}
          </div>

          {viewTab === "team" && teamOptions.length > 0 && (
            <select className="sport-select" style={{ fontSize: 12, padding: "6px 10px" }}
              value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {viewTab === "day" && dayOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {dayOptions.map((day) => (
                <button key={day} type="button" onClick={() => setSelectedDay(day)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200"
                  style={selectedDay === day
                    ? { background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
                    : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {day}
                </button>
              ))}
            </div>
          )}
        </div>

        {matches.length === 0 ? (
          <div className="p-8 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
            <div className="text-2xl mb-2">⚽</div>
            <div>Nessuna partita disponibile per questo filtro.</div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {matches.map((match) => {
              const draft = resultDrafts[match.id] || EMPTY_RESULT;
              const hasResult = Boolean(match.result);
              const homeWin = hasResult && match.result!.goals_home > match.result!.goals_away;
              const awayWin = hasResult && match.result!.goals_away > match.result!.goals_home;

              return (
                <div key={match.id} className="rounded-2xl p-4"
                  style={{ background: hasResult ? "rgba(0,230,118,0.04)" : "rgba(255,255,255,0.03)", border: hasResult ? "1px solid rgba(0,230,118,0.15)" : "1px solid rgba(255,255,255,0.07)" }}>

                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                        {match.group_name || "Finali"}
                      </span>
                      {hasResult && <span className="sport-badge-neon" style={{ fontSize: "10px" }}>Giocata</span>}
                    </div>
                    <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {match.slot ? `${match.slot.day_label} · ${match.slot.start_time}` : "Da schedulare"}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold mb-2 truncate" style={{ color: homeWin ? "#ffffff" : "rgba(255,255,255,0.7)" }}>
                        {homeWin && <span className="mr-1" style={{ color: "#00e676" }}>▲</span>}
                        {match.team_home}
                      </div>
                      <input type="number" min={0} className="sport-input-sm"
                        style={{ fontSize: "22px", fontFamily: "Rajdhani, sans-serif", fontWeight: 700, width: 60 }}
                        value={draft.goals_home}
                        onChange={(e) => updateDraft(match.id, "goals_home", Number(e.target.value))} />
                    </div>
                    <div className="text-xs font-bold flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>VS</div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="text-sm font-semibold mb-2 truncate" style={{ color: awayWin ? "#ffffff" : "rgba(255,255,255,0.7)" }}>
                        {match.team_away}
                        {awayWin && <span className="ml-1" style={{ color: "#00e676" }}>▲</span>}
                      </div>
                      <div className="flex justify-end">
                        <input type="number" min={0} className="sport-input-sm"
                          style={{ fontSize: "22px", fontFamily: "Rajdhani, sans-serif", fontWeight: 700, width: 60 }}
                          value={draft.goals_away}
                          onChange={(e) => updateDraft(match.id, "goals_away", Number(e.target.value))} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>Falli</span>
                      <input type="number" min={0} className="sport-input-sm" style={{ width: 48 }}
                        value={draft.yellow_home}
                        onChange={(e) => updateDraft(match.id, "yellow_home", Number(e.target.value))} />
                      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>—</span>
                      <input type="number" min={0} className="sport-input-sm" style={{ width: 48 }}
                        value={draft.yellow_away}
                        onChange={(e) => updateDraft(match.id, "yellow_away", Number(e.target.value))} />
                      <button type="button" onClick={() => resetFouls(match.id)}
                        className="text-xs px-2.5 py-1 rounded-lg transition-all duration-150"
                        style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}
                        title="Reset falli (es. all'intervallo)">
                        ↺ Reset
                      </button>
                    </div>
                    <div className="ml-auto">
                      <button type="button" className="sport-btn-primary" style={{ padding: "8px 16px", fontSize: "13px" }}
                        onClick={() => void saveResult(match.id)} disabled={setResultMutation.isPending}>
                        {setResultMutation.isPending ? "Salvataggio..." : "✓ Salva"}
                      </button>
                    </div>
                  </div>

                  <GoalsPanel
                    match={match}
                    onGoalAdded={(attributedTeamId) =>
                      handleGoalAdded(match.id, match.team_home_id || "", attributedTeamId)
                    }
                    onGoalDeleted={(goal) =>
                      handleGoalDeleted(match.id, match.team_home_id || "", goal)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Merge modal */}
      {showMerge && (
        <MergeModal
          tid={tid}
          scorers={scorers}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
}
