import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { BracketMatch, BracketTeam, Tournament } from "../types/index";
import { buildTournamentPairs } from "../utils/tournamentPairs";

// ── Label helpers ──────────────────────────────────────────────────────────

function phaseLabel(phase: string) {
  const normalized = (phase || "").toLowerCase();
  if (normalized === "round16") return "Ottavi";
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

// ── Manual team picker modal ───────────────────────────────────────────────

type ManualPickerProps = {
  gender: "M" | "F";
  teams: BracketTeam[];
  liveMode: boolean; // true = group phase not complete yet
  onConfirm: (teamIds: string[]) => void;
  onCancel: () => void;
  loading: boolean;
};

function ManualPicker({ gender, teams, liveMode, onConfirm, onCancel, loading }: ManualPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const genderColor = gender === "M" ? "#3b82f6" : "#ec4899";

  const toggle = (teamId: string, disabled: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Sort by group then position
  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.group.localeCompare(b.group) || a.position - b.position),
    [teams]
  );

  // Group by group name for display
  const byGroup = useMemo(() => {
    const map = new Map<string, BracketTeam[]>();
    for (const t of sortedTeams) {
      const list = map.get(t.group) || [];
      list.push(t);
      map.set(t.group, list);
    }
    return [...map.entries()];
  }, [sortedTeams]);

  const selectedCount = selected.size;
  const isPowerOf2 = selectedCount >= 2 && (selectedCount & (selectedCount - 1)) === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: "#0f1117", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}>
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1"
              style={{ color: genderColor }}>Modalità Manuale · {gender === "M" ? "Maschile" : "Femminile"}</div>
            <h3 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: 22, fontWeight: 800 }}>
              Seleziona le squadre finaliste
            </h3>
            {liveMode && (
              <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>
                ⚠ Fase a gironi in corso — solo le squadre già qualificate al 100% sono selezionabili
              </p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="rounded-xl p-2 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Team list */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {byGroup.map(([groupName, groupTeams]) => (
            <div key={groupName}>
              <div className="text-xs font-bold uppercase tracking-widest mb-2 px-1"
                style={{ color: "rgba(255,255,255,0.4)" }}>
                Girone {groupName}
                {!groupTeams[0]?.group_complete && (
                  <span className="ml-2 text-xs font-normal" style={{ color: "#f59e0b" }}>
                    ({groupTeams[0]?.matches_played}/{groupTeams[0]?.matches_total} giocate)
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {groupTeams.map((team) => {
                  const disabled = liveMode && !team.is_confirmed;
                  const isSelected = selected.has(team.team_id);
                  return (
                    <button
                      key={team.team_id}
                      type="button"
                      onClick={() => toggle(team.team_id, disabled)}
                      disabled={disabled}
                      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-150"
                      style={{
                        background: isSelected
                          ? "rgba(0,230,118,0.1)"
                          : disabled
                          ? "rgba(255,255,255,0.02)"
                          : "rgba(255,255,255,0.04)",
                        border: isSelected
                          ? "1px solid rgba(0,230,118,0.35)"
                          : disabled
                          ? "1px solid rgba(255,255,255,0.04)"
                          : "1px solid rgba(255,255,255,0.08)",
                        opacity: disabled ? 0.45 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {/* Position badge */}
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{
                          background: team.position <= 2 ? `${genderColor}20` : "rgba(255,255,255,0.07)",
                          color: team.position <= 2 ? genderColor : "rgba(255,255,255,0.4)",
                        }}>
                        {team.position}
                      </span>

                      {/* Team name */}
                      <span className="flex-1 text-sm font-semibold truncate"
                        style={{ color: isSelected ? "#00e676" : disabled ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)" }}>
                        {team.team_name}
                      </span>

                      {/* Stats */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {team.points} pt
                        </span>
                        {team.goal_diff !== 0 && (
                          <span className="text-xs tabular-nums"
                            style={{ color: team.goal_diff > 0 ? "#00e676" : "#f87171" }}>
                            {team.goal_diff > 0 ? "+" : ""}{team.goal_diff}
                          </span>
                        )}
                        {/* Qualification badge */}
                        {team.is_confirmed ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: "rgba(0,230,118,0.12)", color: "#00e676" }}>
                            ✓ Confermata
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                            ⏳ In corso
                          </span>
                        )}
                      </div>

                      {/* Checkbox indicator */}
                      <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{
                          background: isSelected ? "#00e676" : "rgba(255,255,255,0.08)",
                          border: isSelected ? "none" : "1px solid rgba(255,255,255,0.15)",
                        }}>
                        {isSelected && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth={3}>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
            {selectedCount} selezionate
            {selectedCount >= 2 && !isPowerOf2 && (
              <span className="ml-2 text-xs" style={{ color: "#f59e0b" }}>
                (il bracket si arrotonda alla prossima potenza di 2)
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="sport-btn-secondary text-sm">
              Annulla
            </button>
            <button
              type="button"
              onClick={() => onConfirm([...selected])}
              disabled={selectedCount < 2 || loading}
              className="sport-btn-primary text-sm"
            >
              {loading ? "Generazione..." : `Genera con ${selectedCount} squadre`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MatchTeamButton ────────────────────────────────────────────────────────

function MatchTeamButton({
  name, onClick, disabled, isWinner
}: {
  name: string;
  onClick: () => void;
  disabled: boolean;
  isWinner?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150"
      style={{
        background: isWinner ? "rgba(0,230,118,0.12)" : "rgba(255,255,255,0.04)",
        border: isWinner ? "1px solid rgba(0,230,118,0.35)" : "1px solid rgba(255,255,255,0.08)",
        color: isWinner ? "#00e676" : disabled ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.8)",
        cursor: disabled ? "not-allowed" : "pointer"
      }}
    >
      {name}
    </button>
  );
}

// ── BracketColumn ──────────────────────────────────────────────────────────

type BracketColumnProps = {
  gender: "M" | "F";
  matches: BracketMatch[];
  loading: boolean;
  onGenerate: (gender: "M" | "F", force?: boolean) => Promise<void>;
  onManual: (gender: "M" | "F") => void;
  onAdvance: (gender: "M" | "F", match: BracketMatch, winnerTeamId: string | null | undefined) => Promise<void>;
  generating: boolean;
  advancing: boolean;
  groupPhaseComplete: boolean;
};

function BracketColumn({
  gender, matches, loading, onGenerate, onManual, onAdvance,
  generating, advancing, groupPhaseComplete,
}: BracketColumnProps) {
  const rounds = groupedRounds(matches);
  const thirdMatch = matches.find((item) => item.phase === "third") || null;
  const genderColor = gender === "M" ? "#3b82f6" : "#ec4899";

  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-2 h-6 rounded-sm"
            style={{ background: genderColor, boxShadow: `0 0 8px ${genderColor}66` }} />
          <h2 className="font-extrabold text-lg tracking-wider"
            style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.92)" }}>
            {gender === "M" ? "MASCHILE" : "FEMMINILE"}
          </h2>
          {!groupPhaseComplete && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
              Live
            </span>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {matches.length > 0 && (
            <button type="button" className="sport-btn-secondary text-sm"
              onClick={() => void onGenerate(gender)}
              disabled={generating || !groupPhaseComplete}>
              {generating ? "Generazione..." : "Rigenera"}
            </button>
          )}
          {!groupPhaseComplete && matches.length === 0 && (
            <button type="button"
              className="text-sm px-3 py-2 rounded-xl font-semibold transition-all duration-200"
              style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}
              onClick={() => void onGenerate(gender, true)}
              disabled={generating}>
              {generating ? "..." : "⚡ Genera ora (parziale)"}
            </button>
          )}
          <button type="button"
            className="text-sm px-3 py-2 rounded-xl font-semibold transition-all duration-200"
            style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)" }}
            onClick={() => onManual(gender)}
            disabled={generating}>
            ✏ Manuale
          </button>
        </div>
      </div>

      {/* Info banner when group phase not complete */}
      {!groupPhaseComplete && matches.length === 0 && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b" }}>
          La fase a gironi non è ancora conclusa. Puoi generare un bracket provvisorio con le squadre attualmente in testa, oppure selezionarle manualmente.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="sport-skeleton rounded-xl h-20" />)}
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-10" style={{ color: "rgba(255,255,255,0.25)" }}>
          <div className="text-3xl font-black mb-2" style={{ fontFamily: "Rajdhani, sans-serif" }}>—</div>
          <div className="text-sm">Nessun bracket generato.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-3">
            {rounds.map((round) => (
              <div key={round.round} className="rounded-xl p-3 space-y-2"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-bold text-xs uppercase tracking-widest mb-1"
                  style={{ fontFamily: "Rajdhani, sans-serif", color: genderColor, letterSpacing: "0.1em" }}>
                  {roundLabel(round.round)}
                </div>
                <div className="space-y-3">
                  {round.matches.map((match) => {
                    const isCompleted = match.status === "completed" || match.status === "done" || match.status === "played";
                    return (
                      <div key={match.id || `${match.round}-${match.bracket_position}`}
                        className="rounded-xl p-3 space-y-2"
                        style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>
                            {phaseLabel(match.phase)}
                          </span>
                          {isCompleted ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "rgba(0,230,118,0.12)", color: "#00e676", border: "1px solid rgba(0,230,118,0.25)" }}>
                              COMPLETATO
                            </span>
                          ) : (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                              IN ATTESA
                            </span>
                          )}
                        </div>
                        <MatchTeamButton
                          name={match.placeholder_home || "TBD"}
                          onClick={() => void onAdvance(gender, match, match.team_home_id)}
                          disabled={!match.team_home_id || !match.id || advancing || isCompleted}
                          isWinner={isCompleted && match.status === "played" /* winner shown via color if needed */}
                        />
                        <div className="text-center text-[10px] font-bold tracking-widest"
                          style={{ color: "rgba(255,255,255,0.2)", fontFamily: "Rajdhani, sans-serif" }}>
                          VS
                        </div>
                        <MatchTeamButton
                          name={match.placeholder_away || "TBD"}
                          onClick={() => void onAdvance(gender, match, match.team_away_id)}
                          disabled={!match.team_away_id || !match.id || advancing || isCompleted}
                          isWinner={false}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {thirdMatch && (
            <div className="rounded-xl p-3 space-y-2"
              style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div className="font-bold text-xs uppercase tracking-widest"
                style={{ fontFamily: "Rajdhani, sans-serif", color: "#f59e0b", letterSpacing: "0.1em" }}>
                Finale 3° Posto
              </div>
              <div className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
                {thirdMatch.placeholder_home || "TBD"}{" "}
                <span style={{ color: "rgba(255,255,255,0.25)" }}>vs</span>{" "}
                {thirdMatch.placeholder_away || "TBD"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Bracket page ──────────────────────────────────────────────────────

export function Bracket() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [selectedPairKey, setSelectedPairKey] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualPicker, setManualPicker] = useState<"M" | "F" | null>(null);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });
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

  // Keep current in sync (set to male if available, otherwise female)
  useEffect(() => {
    if (!selectedPair) return;
    const t = selectedPair.male || selectedPair.female;
    if (t && current?.id !== t.id) setCurrent(t);
  }, [selectedPair, current?.id, setCurrent]);

  const maleTid = selectedPair?.male?.id || "";
  const femaleTid = selectedPair?.female?.id || "";

  const bracketMQuery = useQuery({
    queryKey: ["bracket", maleTid, "M"],
    queryFn: () => tournamentApi.getBracket(maleTid, "M"),
    enabled: Boolean(maleTid)
  });

  const bracketFQuery = useQuery({
    queryKey: ["bracket", femaleTid, "F"],
    queryFn: () => tournamentApi.getBracket(femaleTid, "F"),
    enabled: Boolean(femaleTid)
  });

  // Teams with qualification status — queried lazily when picker is opened
  const teamsQueryM = useQuery({
    queryKey: ["bracketTeams", maleTid, "M"],
    queryFn: () => tournamentApi.getBracketTeams(maleTid, "M") as Promise<BracketTeam[]>,
    enabled: Boolean(maleTid) && manualPicker === "M",
  });

  const teamsQueryF = useQuery({
    queryKey: ["bracketTeams", femaleTid, "F"],
    queryFn: () => tournamentApi.getBracketTeams(femaleTid, "F") as Promise<BracketTeam[]>,
    enabled: Boolean(femaleTid) && manualPicker === "F",
  });

  const generateMutation = useMutation({
    mutationFn: ({ gender, force }: { gender: "M" | "F"; force: boolean }) => {
      const gtid = gender === "M" ? maleTid : femaleTid;
      return tournamentApi.generateBracket(gtid, gender, force);
    },
    onSuccess: async (_, vars) => {
      const gtid = vars.gender === "M" ? maleTid : femaleTid;
      await queryClient.invalidateQueries({ queryKey: ["bracket", gtid, vars.gender] });
    }
  });

  const manualMutation = useMutation({
    mutationFn: ({ gender, teamIds }: { gender: "M" | "F"; teamIds: string[] }) => {
      const gtid = gender === "M" ? maleTid : femaleTid;
      return tournamentApi.generateBracketManual(gtid, gender, teamIds);
    },
    onSuccess: async (_, vars) => {
      const gtid = vars.gender === "M" ? maleTid : femaleTid;
      await queryClient.invalidateQueries({ queryKey: ["bracket", gtid, vars.gender] });
      setManualPicker(null);
    }
  });

  const advanceMutation = useMutation({
    mutationFn: ({ gender, matchId, winnerTeamId }: { gender: "M" | "F"; matchId: string; winnerTeamId: string }) => {
      const gtid = gender === "M" ? maleTid : femaleTid;
      return tournamentApi.advanceBracket(gtid, gender, matchId, winnerTeamId);
    },
    onSuccess: async (_, vars) => {
      const gtid = vars.gender === "M" ? maleTid : femaleTid;
      await queryClient.invalidateQueries({ queryKey: ["bracket", gtid, vars.gender] });
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

  // Determine if group phase is complete per gender (based on teams data)
  // We infer from teamsQuery: if all teams have group_complete=true
  // Fallback: assume complete if bracket already exists
  const isGroupCompleteM = useMemo(() => {
    const teams = teamsQueryM.data;
    if (!teams || teams.length === 0) return matchesM.length > 0; // if bracket exists, assume complete
    return teams.every((t) => t.group_complete);
  }, [teamsQueryM.data, matchesM.length]);

  const isGroupCompleteF = useMemo(() => {
    const teams = teamsQueryF.data;
    if (!teams || teams.length === 0) return matchesF.length > 0;
    return teams.every((t) => t.group_complete);
  }, [teamsQueryF.data, matchesF.length]);

  const onGenerate = async (gender: "M" | "F", force = false) => {
    const gtid = gender === "M" ? maleTid : femaleTid;
    if (!gtid) { setErrorMessage(`Sezione ${gender === "M" ? "maschile" : "femminile"} non configurata.`); return; }
    setErrorMessage(null);
    try {
      await generateMutation.mutateAsync({ gender, force });
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMessage(msg || (error instanceof Error ? error.message : "Errore durante generazione bracket."));
    }
  };

  const onManualConfirm = async (teamIds: string[]) => {
    if (!manualPicker) return;
    const gtid = manualPicker === "M" ? maleTid : femaleTid;
    if (!gtid) return;
    setErrorMessage(null);
    try {
      await manualMutation.mutateAsync({ gender: manualPicker, teamIds });
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMessage(msg || (error instanceof Error ? error.message : "Errore generazione manuale."));
    }
  };

  const onAdvance = async (gender: "M" | "F", match: BracketMatch, winnerTeamId: string | null | undefined) => {
    if (!winnerTeamId || !match.id) return;
    setErrorMessage(null);
    try {
      await advanceMutation.mutateAsync({ gender, matchId: match.id, winnerTeamId });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore avanzamento bracket.");
    }
  };

  // Fetch teams data when manual picker opens
  const pickerTeams = manualPicker === "M"
    ? (teamsQueryM.data || []) as BracketTeam[]
    : (teamsQueryF.data || []) as BracketTeam[];

  const pickerLoading = manualPicker === "M" ? teamsQueryM.isLoading : teamsQueryF.isLoading;

  // Live mode: group phase not complete for the picker's gender
  const pickerLiveMode = manualPicker === "M" ? !isGroupCompleteM : !isGroupCompleteF;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>Finali</div>
        <h1 className="text-3xl font-extrabold tracking-tight"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.95)" }}>
          Bracket Finali
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Tabellone finale — generazione automatica, parziale o manuale.
        </p>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

      {/* Tournament selector */}
      <section className="rounded-xl p-4 flex flex-wrap items-end gap-4"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: "rgba(255,255,255,0.35)" }}>
            Edizione
          </span>
          <select className="sport-select min-w-52" value={selectedPairKey}
            onChange={(e) => setSelectedPairKey(e.target.value)}>
            {pairs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {selectedPair && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {(["M", "F"] as const).map((g) => {
              const t = g === "M" ? selectedPair.male : selectedPair.female;
              const color = g === "M" ? "#60a5fa" : "#f472b6";
              const label = g === "M" ? "Maschile" : "Femminile";
              return (
                <span key={g} className="px-2.5 py-1 rounded-lg font-medium"
                  style={{
                    background: t ? `${color}12` : "rgba(255,255,255,0.04)",
                    color: t ? color : "rgba(255,255,255,0.25)",
                    border: `1px solid ${t ? color + "35" : "rgba(255,255,255,0.07)"}`,
                  }}>
                  {g === "M" ? "♂" : "♀"} {label}
                  {!t && <em className="ml-1">— non configurato</em>}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* Bracket columns */}
      <section className="grid gap-4 xl:grid-cols-2">
        <BracketColumn
          gender="M"
          matches={matchesM}
          loading={bracketMQuery.isLoading}
          onGenerate={onGenerate}
          onManual={(g) => setManualPicker(g)}
          onAdvance={onAdvance}
          generating={generateMutation.isPending}
          advancing={advanceMutation.isPending}
          groupPhaseComplete={isGroupCompleteM}
        />
        <BracketColumn
          gender="F"
          matches={matchesF}
          loading={bracketFQuery.isLoading}
          onGenerate={onGenerate}
          onManual={(g) => setManualPicker(g)}
          onAdvance={onAdvance}
          generating={generateMutation.isPending}
          advancing={advanceMutation.isPending}
          groupPhaseComplete={isGroupCompleteF}
        />
      </section>

      {/* Manual picker modal */}
      {manualPicker && (
        pickerLoading ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.6)" }}>
            <div className="text-white text-sm">Caricamento squadre...</div>
          </div>
        ) : (
          <ManualPicker
            gender={manualPicker}
            teams={pickerTeams}
            liveMode={pickerLiveMode}
            onConfirm={(ids) => void onManualConfirm(ids)}
            onCancel={() => setManualPicker(null)}
            loading={manualMutation.isPending}
          />
        )
      )}
    </div>
  );
}
