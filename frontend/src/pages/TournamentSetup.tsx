import { useEffect, useMemo, useState } from "react";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Tournament, TournamentDay } from "../types";
import { buildGenderTournamentName, buildTournamentPairs } from "../utils/tournamentPairs";

type TimeWindowInput = {
  start: string;
  end: string;
};

type DayInput = {
  label: string;
  date: string;
  windows: TimeWindowInput[];
};

type PenaltyWeights = Record<string, number>;
type SetupMode = "create" | "edit";

const STEPS = [
  "Info Base",
  "Fasce Orarie",
  "Formato",
  "Pesi Penalita"
] as const;

const DEFAULT_TIEBREAKERS = [
  "head_to_head",
  "goal_diff",
  "goals_for",
  "goals_against",
  "draw"
];

const TIEBREAKER_LABELS: Record<string, string> = {
  head_to_head: "Scontro Diretto",
  goal_diff: "Differenza Reti",
  goals_for: "Gol Fatti",
  goals_against: "Gol Subiti",
  draw: "Sorteggio"
};

const PENALTY_FIELDS = [
  {
    key: "pref_day_violation",
    label: "Preferenza Giorno",
    description: "Penalita quando il match cade in un giorno non preferito."
  },
  {
    key: "pref_window_violation",
    label: "Preferenza Fascia",
    description: "Penalita quando il match cade fuori fascia preferita."
  },
  {
    key: "consecutive_penalty",
    label: "Consecutivita",
    description: "Penalita per partite troppo ravvicinate per la stessa squadra."
  },
  {
    key: "rest_violation",
    label: "Riposo Minimo",
    description: "Penalita per violazione del riposo minimo tra match."
  },
  {
    key: "equity_imbalance",
    label: "Equita Oraria",
    description: "Penalita per squilibri negli orari assegnati alle squadre."
  },
  {
    key: "finals_day_preference",
    label: "Finals Day",
    description: "Penalita se una finale cade fuori dai giorni finali selezionati."
  }
] as const;

const DEFAULT_PENALTIES: PenaltyWeights = {
  pref_day_violation: 10,
  pref_window_violation: 8,
  consecutive_penalty: 5,
  rest_violation: 15,
  equity_imbalance: 3,
  finals_day_preference: 20
};

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTimeString(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function generateSlotsForWindow(window: TimeWindowInput, matchDuration: number, bufferMinutes: number) {
  if (!window.start || !window.end || window.start >= window.end) {
    return [] as Array<{ start_time: string; end_time: string }>;
  }

  const step = matchDuration + bufferMinutes;
  let current = toMinutes(window.start);
  const end = toMinutes(window.end);
  const slots: Array<{ start_time: string; end_time: string }> = [];

  while (current + matchDuration <= end) {
    slots.push({
      start_time: toTimeString(current),
      end_time: toTimeString(current + matchDuration)
    });
    current += step;
  }

  return slots;
}

function buildInitialDays(totalDays: number): DayInput[] {
  return Array.from({ length: totalDays }, (_, index) => ({
    label: `Giorno ${index + 1}`,
    date: "",
    windows: [{ start: "10:00", end: "13:00" }]
  }));
}

function parseNameAndYear(rawName: string) {
  const value = rawName.trim();
  const match = value.match(/^(.*)\s(20\d{2}|21\d{2})$/);
  if (!match) return { name: value, year: new Date().getFullYear() };
  return { name: match[1].trim(), year: Number(match[2]) };
}

function SortableTiebreakerItem({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        background: isDragging ? "rgba(0,230,118,0.1)" : "rgba(255,255,255,0.04)",
        border: isDragging ? "1px solid rgba(0,230,118,0.3)" : "1px solid rgba(255,255,255,0.08)",
        color: isDragging ? "#00e676" : "rgba(255,255,255,0.75)"
      }}
      {...attributes}
      {...listeners}
      className={`rounded-lg px-3 py-2.5 text-sm font-medium cursor-grab transition-all duration-150 flex items-center gap-2 ${isDragging ? "shadow-lg opacity-70" : ""}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ opacity: 0.4, flexShrink: 0 }}>
        <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" strokeLinecap="round" />
      </svg>
      {TIEBREAKER_LABELS[id] ?? id}
    </div>
  );
}

export function TournamentSetup() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [mode, setMode] = useState<SetupMode>("create");
  const [loadedTournamentId, setLoadedTournamentId] = useState<string>("");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState("Torneo Calcetto Saponato");
  const [year, setYear] = useState(new Date().getFullYear());
  const [createAsPair, setCreateAsPair] = useState(true);
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [maxTeams, setMaxTeams] = useState<number | "">(16);
  const [maleMaxTeams, setMaleMaxTeams] = useState(16);
  const [femaleMaxTeams, setFemaleMaxTeams] = useState(6);

  const [totalDays, setTotalDays] = useState(4);
  const [finalsDays, setFinalsDays] = useState<number[]>([]);
  const [days, setDays] = useState<DayInput[]>(() => buildInitialDays(4));
  const [matchDuration, setMatchDuration] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(5);

  const [teamsPerGroup, setTeamsPerGroup] = useState(4);
  const [teamsAdvancingPerGroup, setTeamsAdvancingPerGroup] = useState(2);
  const [wildcardEnabled, setWildcardEnabled] = useState(false);
  const [wildcardCount, setWildcardCount] = useState(0);
  const [pointsWin, setPointsWin] = useState(3);
  const [pointsDraw, setPointsDraw] = useState(1);
  const [pointsLoss, setPointsLoss] = useState(0);
  const [tiebreakers, setTiebreakers] = useState<string[]>(DEFAULT_TIEBREAKERS);

  const [penaltyWeights, setPenaltyWeights] = useState<PenaltyWeights>(DEFAULT_PENALTIES);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    })
  );

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });
  const deleteTournamentMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
    }
  });

  const tournamentPairs = useMemo(
    () => buildTournamentPairs(((tournamentsQuery.data || []) as Tournament[])),
    [tournamentsQuery.data]
  );
  const currentPair = useMemo(
    () =>
      tournamentPairs.find((pair) => pair.male?.id === current?.id || pair.female?.id === current?.id) ?? null,
    [current?.id, tournamentPairs]
  );

  useEffect(() => {
    if (!current && tournamentsQuery.data?.length) {
      setCurrent((tournamentsQuery.data as Tournament[])[0]);
    }
  }, [current, setCurrent, tournamentsQuery.data]);

  const resetCreateForm = () => {
    setLoadedTournamentId("");
    setStep(0);
    setName("Torneo Calcetto Saponato");
    setYear(new Date().getFullYear());
    setCreateAsPair(true);
    setGender("");
    setMaxTeams(16);
    setMaleMaxTeams(16);
    setFemaleMaxTeams(6);
    setTotalDays(4);
    setFinalsDays([]);
    setDays(buildInitialDays(4));
    setMatchDuration(30);
    setBufferMinutes(5);
    setTeamsPerGroup(4);
    setTeamsAdvancingPerGroup(2);
    setWildcardEnabled(false);
    setWildcardCount(0);
    setPointsWin(3);
    setPointsDraw(1);
    setPointsLoss(0);
    setTiebreakers(DEFAULT_TIEBREAKERS);
    setPenaltyWeights(DEFAULT_PENALTIES);
  };

  useEffect(() => {
    if (mode !== "edit" || !current?.id || loadedTournamentId === current.id) return;
    let cancelled = false;

    const load = async () => {
      setLoadingEdit(true);
      setError(null);
      setSuccess(null);
      try {
        const [tournament, dayPayload] = await Promise.all([
          tournamentApi.get(current.id),
          tournamentApi.getDays(current.id)
        ]);
        if (cancelled) return;

        const parsed = parseNameAndYear(tournament.name || "");
        setName(parsed.name || tournament.name || "");
        setYear(parsed.year);
        setCreateAsPair(false);
        setGender((tournament.gender || "") as "" | "M" | "F");
        setMaxTeams(tournament.max_teams ?? "");
        setTotalDays(Math.max(1, Number(tournament.total_days || 1)));
        setMatchDuration(Number(tournament.match_duration_minutes || 30));
        setBufferMinutes(Number(tournament.buffer_minutes || 0));
        setTeamsPerGroup(Number(tournament.teams_per_group || 4));
        setTeamsAdvancingPerGroup(Number(tournament.teams_advancing_per_group || 2));
        setWildcardEnabled(Boolean(tournament.wildcard_enabled));
        setWildcardCount(Number(tournament.wildcard_count || 0));
        setPointsWin(Number(tournament.points_win || 3));
        setPointsDraw(Number(tournament.points_draw || 1));
        setPointsLoss(Number(tournament.points_loss || 0));
        setTiebreakers((tournament.tiebreaker_order || DEFAULT_TIEBREAKERS) as string[]);
        setPenaltyWeights({ ...DEFAULT_PENALTIES, ...(tournament.penalty_weights || {}) });

        const daysLoaded = (dayPayload as TournamentDay[]).map((day) => ({
          label: day.label,
          date: day.date,
          windows: day.time_windows || [{ start: "10:00", end: "13:00" }]
        }));
        const mappedDays =
          daysLoaded.length > 0 ? daysLoaded : buildInitialDays(Math.max(1, Number(tournament.total_days || 1)));
        setDays(mappedDays);
        setTotalDays(mappedDays.length);

        const finals = (dayPayload as TournamentDay[])
          .map((day, index) => ({ index, is_finals_day: day.is_finals_day }))
          .filter((day) => day.is_finals_day)
          .map((day) => day.index + 1);
        setFinalsDays(finals);

        setLoadedTournamentId(current.id);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento configurazione torneo.");
        }
      } finally {
        if (!cancelled) {
          setLoadingEdit(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [current?.id, loadedTournamentId, mode]);

  useEffect(() => {
    setDays((current) => {
      const clamped = Math.max(1, totalDays);
      if (current.length === clamped) return current;
      if (current.length > clamped) return current.slice(0, clamped);
      const toAdd = buildInitialDays(clamped).slice(current.length);
      return [...current, ...toAdd];
    });

    setFinalsDays((current) => current.filter((day) => day <= totalDays));
  }, [totalDays]);

  const slotPreview = useMemo(
    () =>
      days.map((day) => {
        const slots = day.windows.flatMap((window) => generateSlotsForWindow(window, matchDuration, bufferMinutes));
        return { label: day.label, slots };
      }),
    [days, matchDuration, bufferMinutes]
  );

  const objectiveFormula = useMemo(
    () => PENALTY_FIELDS.map((field) => `${penaltyWeights[field.key]} * ${field.key}`).join(" + "),
    [penaltyWeights]
  );

  const summary = useMemo(() => {
    const totalSlots = slotPreview.reduce((acc, day) => acc + day.slots.length, 0);
    return {
      totalSlots,
      finalsDaysLabel: finalsDays.length > 0 ? finalsDays.map((day) => `G${day}`).join(", ") : "Nessuno"
    };
  }, [finalsDays, slotPreview]);

  const updateDay = <K extends keyof DayInput>(index: number, key: K, value: DayInput[K]) => {
    setDays((current) => current.map((day, idx) => (idx === index ? { ...day, [key]: value } : day)));
  };

  const addWindow = (dayIndex: number) => {
    setDays((current) =>
      current.map((day, idx) =>
        idx === dayIndex
          ? {
              ...day,
              windows: [...day.windows, { start: "15:00", end: "19:00" }]
            }
          : day
      )
    );
  };

  const removeWindow = (dayIndex: number, windowIndex: number) => {
    setDays((current) =>
      current.map((day, idx) =>
        idx === dayIndex
          ? {
              ...day,
              windows: day.windows.filter((_, wi) => wi !== windowIndex)
            }
          : day
      )
    );
  };

  const updateWindow = (dayIndex: number, windowIndex: number, key: keyof TimeWindowInput, value: string) => {
    setDays((current) =>
      current.map((day, idx) =>
        idx === dayIndex
          ? {
              ...day,
              windows: day.windows.map((window, wi) => (wi === windowIndex ? { ...window, [key]: value } : window))
            }
          : day
      )
    );
  };

  const toggleFinalsDay = (dayNumber: number, checked: boolean) => {
    setFinalsDays((current) => {
      if (checked) return [...new Set([...current, dayNumber])].sort((a, b) => a - b);
      return current.filter((day) => day !== dayNumber);
    });
  };

  const onTiebreakerDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTiebreakers((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const moveTiebreaker = (index: number, direction: -1 | 1) => {
    setTiebreakers((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const validateStep = (targetStep: number) => {
    if (targetStep === 0) return true;

    if (!name.trim()) {
      setError("Inserisci il nome del torneo.");
      return false;
    }

    if (totalDays < 1) {
      setError("Il torneo deve avere almeno un giorno.");
      return false;
    }

    if (targetStep === 1) return true;

    const invalidDay = days.find(
      (day) =>
        !day.date ||
        day.windows.filter((window) => window.start && window.end && window.start < window.end).length === 0
    );
    if (invalidDay) {
      setError(`Controlla date e fasce orarie: "${invalidDay.label}" non e valida.`);
      return false;
    }

    if (targetStep === 2) return true;

    if (teamsAdvancingPerGroup > teamsPerGroup) {
      setError("Le squadre qualificate non possono superare le squadre per girone.");
      return false;
    }

    return true;
  };

  const nextStep = () => {
    setError(null);
    if (!validateStep(step + 1)) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const prevStep = () => {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  };

  const onDeleteCurrentTournament = async () => {
    if (!current?.id) {
      setError("Seleziona prima un torneo da eliminare.");
      return;
    }
    if (!confirm(`Eliminare il torneo "${current.name}"?`)) return;

    setError(null);
    setSuccess(null);
    try {
      const deletedId = current.id;
      await deleteTournamentMutation.mutateAsync(deletedId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teams", deletedId] }),
        queryClient.invalidateQueries({ queryKey: ["days", deletedId] }),
        queryClient.invalidateQueries({ queryKey: ["slots", deletedId] }),
        queryClient.invalidateQueries({ queryKey: ["groups", deletedId] }),
        queryClient.invalidateQueries({ queryKey: ["groups-compatibility", deletedId] })
      ]);

      const remaining = (((tournamentsQuery.data || []) as Tournament[]).filter((tournament) => tournament.id !== deletedId));
      setCurrent(remaining[0] || null);
      setLoadedTournamentId("");
      if (remaining.length === 0) {
        setMode("create");
        resetCreateForm();
      }
      setSuccess("Torneo eliminato con successo.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore durante eliminazione torneo.");
    }
  };

  const onDeleteCurrentPair = async () => {
    if (!currentPair) {
      setError("Nessuna coppia M/F associata al torneo selezionato.");
      return;
    }

    const tournamentIds = [currentPair.male?.id, currentPair.female?.id].filter(Boolean) as string[];
    if (tournamentIds.length === 0) {
      setError("Nessun torneo da eliminare.");
      return;
    }

    const confirmLabel = currentPair.label || "questa coppia";
    if (!confirm(`Eliminare la coppia "${confirmLabel}" (${tournamentIds.length} tornei)?`)) return;

    setError(null);
    setSuccess(null);
    try {
      await Promise.all(tournamentIds.map((id) => tournamentApi.delete(id)));
      await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      await Promise.all(tournamentIds.map((id) => queryClient.invalidateQueries({ queryKey: ["teams", id] })));
      setCurrent(null);
      setLoadedTournamentId("");
      setMode("create");
      resetCreateForm();
      setSuccess("Coppia di tornei eliminata.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore durante eliminazione coppia tornei.");
    }
  };

  const submit = async () => {
    setError(null);
    setSuccess(null);

    if (!validateStep(STEPS.length - 1)) return;

    const normalizedName = name.trim();
    const suffix = String(year).trim();
    const parsedBase = parseNameAndYear(normalizedName);
    const tournamentName = suffix && !normalizedName.endsWith(suffix) ? `${normalizedName} ${suffix}` : normalizedName;
    const basePayload = {
      total_days: totalDays,
      match_duration_minutes: matchDuration,
      buffer_minutes: bufferMinutes,
      teams_per_group: teamsPerGroup,
      teams_advancing_per_group: teamsAdvancingPerGroup,
      wildcard_enabled: wildcardEnabled,
      wildcard_count: wildcardEnabled ? wildcardCount : 0,
      points_win: pointsWin,
      points_draw: pointsDraw,
      points_loss: pointsLoss,
      tiebreaker_order: tiebreakers,
      penalty_weights: penaltyWeights
    };
    const daysPayload = days.map((day, index) => ({
      date: day.date,
      label: day.label || `Giorno ${index + 1}`,
      is_finals_day: finalsDays.includes(index + 1),
      time_windows: day.windows.filter((window) => window.start && window.end && window.start < window.end)
    }));

    setSaving(true);
    try {
      if (mode === "edit") {
        if (!current?.id) {
          throw new Error("Seleziona un torneo da modificare.");
        }
        const tournamentPayload = {
          ...basePayload,
          name: tournamentName,
          gender: gender || null,
          max_teams: gender && maxTeams !== "" ? Number(maxTeams) : null
        };
        const updated = await tournamentApi.update(current.id, tournamentPayload);
        await tournamentApi.replaceDays(current.id, daysPayload);
        await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
        setCurrent(updated);
        setLoadedTournamentId(current.id);
        setSuccess(`Torneo aggiornato con successo (ID: ${current.id}).`);
      } else if (createAsPair) {
        const baseNameForPair = parsedBase.name || normalizedName;
        const malePayload = {
          ...basePayload,
          name: buildGenderTournamentName(baseNameForPair, year, "M"),
          gender: "M",
          max_teams: Math.max(2, Number(maleMaxTeams) || 16)
        };
        const femalePayload = {
          ...basePayload,
          name: buildGenderTournamentName(baseNameForPair, year, "F"),
          gender: "F",
          max_teams: Math.max(2, Number(femaleMaxTeams) || 6)
        };

        const [maleTournament, femaleTournament] = await Promise.all([
          tournamentApi.create(malePayload),
          tournamentApi.create(femalePayload)
        ]);
        await Promise.all([
          tournamentApi.replaceDays(maleTournament.id, daysPayload),
          tournamentApi.replaceDays(femaleTournament.id, daysPayload)
        ]);
        await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
        setCurrent(maleTournament);
        setMode("edit");
        setCreateAsPair(false);
        setLoadedTournamentId(maleTournament.id);
        setSuccess(
          `Coppia creata con successo. M: ${maleTournament.id} | F: ${femaleTournament.id}.`
        );
      } else {
        const tournamentPayload = {
          ...basePayload,
          name: tournamentName,
          gender: gender || null,
          max_teams: gender && maxTeams !== "" ? Number(maxTeams) : null
        };
        const created = await tournamentApi.create(tournamentPayload);
        await tournamentApi.replaceDays(created.id, daysPayload);
        await queryClient.invalidateQueries({ queryKey: ["tournaments"] });
        setCurrent(created);
        setMode("edit");
        setLoadedTournamentId(created.id);
        setSuccess(`Torneo creato con successo (ID: ${created.id}).`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio.");
    } finally {
      setSaving(false);
    }
  };

  const cardStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <header>
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.95)" }}
        >
          Configurazione Torneo
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Crea un nuovo torneo o modifica quello esistente.
        </p>
      </header>

      {/* Tournament selector + mode */}
      <section className="rounded-xl p-4 space-y-4" style={cardStyle}>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Torneo attivo
            </span>
            <select
              className="sport-select min-w-56"
              value={current?.id || ""}
              onChange={(event) => {
                const selected = ((tournamentsQuery.data || []) as Tournament[]).find((tournament) => tournament.id === event.target.value);
                if (selected) {
                  setCurrent(selected);
                  setLoadedTournamentId("");
                }
              }}
            >
              {((tournamentsQuery.data || []) as Tournament[]).map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name}
                </option>
              ))}
            </select>
          </label>

          {/* Mode toggle */}
          <div
            className="inline-flex rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {(["create", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="px-4 py-2 text-sm font-semibold transition-all duration-200"
                style={{
                  background: mode === m ? "rgba(0,230,118,0.12)" : "transparent",
                  color: mode === m ? "#00e676" : "rgba(255,255,255,0.45)",
                  fontFamily: "Rajdhani, sans-serif",
                  letterSpacing: "0.04em"
                }}
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setSuccess(null);
                  if (m === "create") resetCreateForm();
                  else setLoadedTournamentId("");
                }}
                disabled={m === "edit" && !current?.id}
              >
                {m === "create" ? "Nuovo torneo" : "Modifica torneo"}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="sport-btn-danger text-sm"
            onClick={() => void onDeleteCurrentTournament()}
            disabled={!current?.id || deleteTournamentMutation.isPending}
          >
            {deleteTournamentMutation.isPending ? "Eliminazione..." : "Elimina torneo"}
          </button>

          <button
            type="button"
            className="sport-btn-danger text-sm"
            onClick={() => void onDeleteCurrentPair()}
            disabled={!currentPair || deleteTournamentMutation.isPending}
          >
            Elimina coppia M/F
          </button>
        </div>
        <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          Coppie M/F rilevate:{" "}
          <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>{tournamentPairs.length}</span>
          {currentPair ? ` — corrente: ${currentPair.label}` : ""}
        </div>
      </section>

      {/* Step progress */}
      <ol className="grid gap-2 md:grid-cols-4">
        {STEPS.map((label, index) => {
          const isActive = index === step;
          const isDone = index < step;
          return (
            <li
              key={label}
              className="rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200"
              style={{
                background: isActive ? "rgba(0,230,118,0.1)" : isDone ? "rgba(0,230,118,0.05)" : "rgba(255,255,255,0.03)",
                border: isActive ? "1px solid rgba(0,230,118,0.35)" : isDone ? "1px solid rgba(0,230,118,0.15)" : "1px solid rgba(255,255,255,0.07)",
                color: isActive ? "#00e676" : isDone ? "rgba(0,230,118,0.6)" : "rgba(255,255,255,0.35)",
                fontFamily: "Rajdhani, sans-serif",
                letterSpacing: "0.04em"
              }}
            >
              <span className="mr-2" style={{ opacity: 0.6 }}>{index + 1}.</span>
              {label}
            </li>
          );
        })}
      </ol>

      {error && <div className="sport-alert-error">{error}</div>}
      {success && <div className="sport-alert-success">{success}</div>}
      {loadingEdit && (
        <div
          className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
          style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#60a5fa" }}
        >
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Caricamento configurazione torneo...
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        {/* Main form */}
        <section className="rounded-xl p-5 space-y-5" style={cardStyle}>

          {/* Step 0: Info Base */}
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 md:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Nome torneo
                </span>
                <input
                  className="sport-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Anno
                </span>
                <input
                  type="number"
                  className="sport-input"
                  value={year}
                  min={2020}
                  max={2100}
                  onChange={(event) => setYear(Number(event.target.value))}
                />
              </label>

              {mode === "create" ? (
                <label
                  className="inline-flex items-center gap-3 text-sm font-medium mt-5 cursor-pointer"
                  style={{ color: "rgba(255,255,255,0.7)" }}
                >
                  <input
                    type="checkbox"
                    checked={createAsPair}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setCreateAsPair(checked);
                      if (checked) setGender("");
                    }}
                    className="w-4 h-4 rounded"
                  />
                  Crea coppia tornei M/F
                </label>
              ) : (
                <div className="text-xs mt-5" style={{ color: "rgba(255,255,255,0.3)" }}>Modifica torneo singolo.</div>
              )}

              {createAsPair && mode === "create" ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Max squadre Maschile
                    </span>
                    <input
                      type="number"
                      min={2}
                      className="sport-input"
                      value={maleMaxTeams}
                      onChange={(event) => setMaleMaxTeams(Math.max(2, Number(event.target.value) || 2))}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Max squadre Femminile
                    </span>
                    <input
                      type="number"
                      min={2}
                      className="sport-input"
                      value={femaleMaxTeams}
                      onChange={(event) => setFemaleMaxTeams(Math.max(2, Number(event.target.value) || 2))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Genere torneo
                    </span>
                    <select
                      className="sport-select"
                      value={gender}
                      onChange={(event) => {
                        const next = event.target.value as "" | "M" | "F";
                        setGender(next);
                        if (next === "M") setMaxTeams(16);
                        if (next === "F") setMaxTeams(6);
                        if (!next) setMaxTeams("");
                      }}
                    >
                      <option value="">Misto / non specificato</option>
                      <option value="M">Maschile (M)</option>
                      <option value="F">Femminile (F)</option>
                    </select>
                  </label>

                  {gender && (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Numero max squadre
                      </span>
                      <input
                        type="number"
                        min={2}
                        className="sport-input"
                        value={maxTeams}
                        onChange={(event) => setMaxTeams(event.target.value === "" ? "" : Number(event.target.value))}
                      />
                    </label>
                  )}
                </>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Numero giorni torneo
                </span>
                <input
                  type="number"
                  min={1}
                  className="sport-input"
                  value={totalDays}
                  onChange={(event) => setTotalDays(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Durata match (min)
                </span>
                <input
                  type="number"
                  min={5}
                  className="sport-input"
                  value={matchDuration}
                  onChange={(event) => setMatchDuration(Math.max(5, Number(event.target.value) || 5))}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Buffer tra match (min)
                </span>
                <input
                  type="number"
                  min={0}
                  className="sport-input"
                  value={bufferMinutes}
                  onChange={(event) => setBufferMinutes(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>

              <div className="md:col-span-2 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Finals Days
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: totalDays }, (_, index) => index + 1).map((dayNumber) => {
                    const isChecked = finalsDays.includes(dayNumber);
                    return (
                      <label
                        key={dayNumber}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium cursor-pointer transition-all duration-150"
                        style={{
                          background: isChecked ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.04)",
                          border: isChecked ? "1px solid rgba(245,158,11,0.35)" : "1px solid rgba(255,255,255,0.08)",
                          color: isChecked ? "#f59e0b" : "rgba(255,255,255,0.45)"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) => toggleFinalsDay(dayNumber, event.target.checked)}
                          className="w-3.5 h-3.5"
                        />
                        G{dayNumber}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Fasce Orarie */}
          {step === 1 && (
            <div className="space-y-4">
              {days.map((day, dayIndex) => {
                const preview = slotPreview[dayIndex]?.slots ?? [];
                const isFinals = finalsDays.includes(dayIndex + 1);
                return (
                  <article
                    key={`day-${dayIndex}`}
                    className="rounded-xl overflow-hidden"
                    style={{
                      border: isFinals ? "1px solid rgba(245,158,11,0.35)" : "1px solid rgba(255,255,255,0.08)"
                    }}
                  >
                    {/* Day header */}
                    <div
                      className="flex items-center justify-between px-4 py-3"
                      style={{
                        background: isFinals ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.05)",
                        borderBottom: isFinals ? "1px solid rgba(245,158,11,0.2)" : "1px solid rgba(255,255,255,0.06)"
                      }}
                    >
                      <span
                        className="font-bold text-base"
                        style={{ fontFamily: "Rajdhani, sans-serif", color: isFinals ? "#f59e0b" : "rgba(255,255,255,0.85)" }}
                      >
                        {day.label || `Giorno ${dayIndex + 1}`}
                      </span>
                      {isFinals && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}
                        >
                          FINALS DAY
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-5">
                      {/* Info giorno: etichetta + data + checkbox */}
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>
                            Etichetta giorno
                          </span>
                          <input
                            className="sport-input"
                            value={day.label}
                            onChange={(event) => updateDay(dayIndex, "label", event.target.value)}
                          />
                        </label>

                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>
                            Data
                          </span>
                          <input
                            type="date"
                            className="sport-input"
                            value={day.date}
                            onChange={(event) => updateDay(dayIndex, "date", event.target.value)}
                          />
                        </label>

                        <label
                          className="flex items-center gap-3 cursor-pointer rounded-xl px-4 py-3 self-end"
                          style={{
                            background: isFinals ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.04)",
                            border: isFinals ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(255,255,255,0.08)"
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={finalsDays.includes(dayIndex + 1)}
                            onChange={(event) => toggleFinalsDay(dayIndex + 1, event.target.checked)}
                            className="w-4 h-4 flex-shrink-0"
                          />
                          <span className="text-sm font-medium" style={{ color: isFinals ? "#f59e0b" : "rgba(255,255,255,0.55)" }}>
                            Giorno finali
                          </span>
                        </label>
                      </div>

                      {/* Fasce orarie */}
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(255,255,255,0.35)" }}>
                          Fasce orarie
                        </div>

                        {/* Intestazione colonne */}
                        <div className="grid gap-3 items-end" style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
                          <span className="text-xs font-medium pb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            Ora inizio
                          </span>
                          <span className="text-xs font-medium pb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            Ora fine
                          </span>
                          <span className="text-xs font-medium pb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                            Slot generati
                          </span>
                          <span />
                        </div>

                        {day.windows.map((window, windowIndex) => {
                          const winSlots = generateSlotsForWindow(window, matchDuration, bufferMinutes);
                          return (
                            <div
                              key={`window-${windowIndex}`}
                              className="grid gap-3 items-center rounded-xl px-3 py-2.5"
                              style={{
                                gridTemplateColumns: "1fr 1fr 1fr auto",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.06)"
                              }}
                            >
                              <input
                                type="time"
                                className="sport-input"
                                value={window.start}
                                onChange={(event) => updateWindow(dayIndex, windowIndex, "start", event.target.value)}
                              />
                              <input
                                type="time"
                                className="sport-input"
                                value={window.end}
                                onChange={(event) => updateWindow(dayIndex, windowIndex, "end", event.target.value)}
                              />
                              <span
                                className="text-sm font-semibold"
                                style={{
                                  fontFamily: "Rajdhani, sans-serif",
                                  color: winSlots.length > 0 ? "#00e676" : "rgba(255,255,255,0.2)"
                                }}
                              >
                                {winSlots.length > 0 ? `${winSlots.length} slot` : "—"}
                              </span>
                              <button
                                type="button"
                                className="sport-btn-danger text-xs px-3 py-2 whitespace-nowrap"
                                onClick={() => removeWindow(dayIndex, windowIndex)}
                                disabled={day.windows.length === 1}
                              >
                                Rimuovi
                              </button>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className="sport-btn-secondary text-sm mt-1"
                          onClick={() => addWindow(dayIndex)}
                        >
                          + Aggiungi fascia oraria
                        </button>
                      </div>

                      {/* Preview slot del giorno */}
                      {preview.length > 0 && (
                        <div
                          className="rounded-xl px-4 py-3"
                          style={{ background: "rgba(0,230,118,0.04)", border: "1px solid rgba(0,230,118,0.12)" }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(0,230,118,0.7)" }}>
                              Slot totali del giorno
                            </span>
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-bold"
                              style={{ background: "rgba(0,230,118,0.15)", color: "#00e676" }}
                            >
                              {preview.length}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {preview.map((slot) => (
                              <span
                                key={`${slot.start_time}-${slot.end_time}`}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium"
                                style={{ background: "rgba(0,230,118,0.08)", color: "#00e676", border: "1px solid rgba(0,230,118,0.15)" }}
                              >
                                {slot.start_time} – {slot.end_time}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {preview.length === 0 && (
                        <div
                          className="rounded-xl px-4 py-3 text-xs"
                          style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171" }}
                        >
                          Nessuno slot generato — controlla che l'ora di fine sia successiva all'ora di inizio e che ci sia spazio per almeno un match ({matchDuration} min).
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Step 2: Formato */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Squadre per girone
                  </span>
                  <input
                    type="number"
                    min={2}
                    className="sport-input"
                    value={teamsPerGroup}
                    onChange={(event) => setTeamsPerGroup(Math.max(2, Number(event.target.value) || 2))}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Squadre che avanzano
                  </span>
                  <input
                    type="number"
                    min={1}
                    className="sport-input"
                    value={teamsAdvancingPerGroup}
                    onChange={(event) => setTeamsAdvancingPerGroup(Math.max(1, Number(event.target.value) || 1))}
                  />
                </label>

                <label
                  className="inline-flex items-center gap-3 text-sm font-medium cursor-pointer mt-2"
                  style={{ color: wildcardEnabled ? "#f97316" : "rgba(255,255,255,0.55)" }}
                >
                  <input
                    type="checkbox"
                    checked={wildcardEnabled}
                    onChange={(event) => setWildcardEnabled(event.target.checked)}
                    className="w-4 h-4"
                  />
                  Wild card abilitata
                </label>

                {wildcardEnabled && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Numero wild card
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="sport-input"
                      value={wildcardCount}
                      onChange={(event) => setWildcardCount(Math.max(0, Number(event.target.value) || 0))}
                    />
                  </label>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: "Punti vittoria", value: pointsWin, setter: setPointsWin },
                  { label: "Punti pareggio", value: pointsDraw, setter: setPointsDraw },
                  { label: "Punti sconfitta", value: pointsLoss, setter: setPointsLoss }
                ].map(({ label, value, setter }) => (
                  <label key={label} className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {label}
                    </span>
                    <input
                      type="number"
                      className="sport-input"
                      value={value}
                      onChange={(event) => setter(Number(event.target.value))}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3
                    className="font-bold text-sm uppercase tracking-widest"
                    style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em" }}
                  >
                    Criteri spareggio
                  </h3>
                  <button
                    type="button"
                    className="sport-btn-secondary text-xs"
                    onClick={() => setTiebreakers(DEFAULT_TIEBREAKERS)}
                  >
                    Ripristina default
                  </button>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTiebreakerDragEnd}>
                  <SortableContext items={tiebreakers} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-2">
                      {tiebreakers.map((item, index) => (
                        <div key={item} className="grid grid-cols-[1fr_auto] gap-2">
                          <SortableTiebreakerItem id={item} />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="rounded-lg px-2 text-xs font-bold transition-colors"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                              onClick={() => moveTiebreaker(index, -1)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="rounded-lg px-2 text-xs font-bold transition-colors"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                              onClick={() => moveTiebreaker(index, 1)}
                              disabled={index === tiebreakers.length - 1}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          )}

          {/* Step 3: Pesi Penalita */}
          {step === 3 && (
            <div className="space-y-4">
              {PENALTY_FIELDS.map((field) => {
                const val = penaltyWeights[field.key];
                const pct = (val / 40) * 100;
                return (
                  <div
                    key={field.key}
                    className="rounded-xl p-4 space-y-3"
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{field.label}</div>
                        <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{field.description}</p>
                      </div>
                      <span
                        className="rounded-lg px-2.5 py-1 text-sm font-bold flex-shrink-0"
                        style={{
                          fontFamily: "Rajdhani, sans-serif",
                          background: val > 15 ? "rgba(239,68,68,0.15)" : val > 8 ? "rgba(245,158,11,0.12)" : "rgba(0,230,118,0.1)",
                          color: val > 15 ? "#f87171" : val > 8 ? "#fbbf24" : "#00e676",
                          border: `1px solid ${val > 15 ? "rgba(239,68,68,0.25)" : val > 8 ? "rgba(245,158,11,0.2)" : "rgba(0,230,118,0.2)"}`
                        }}
                      >
                        {val}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="sport-progress-track">
                        <div
                          className="sport-progress-fill"
                          style={{ width: `${pct}%`, background: val > 15 ? "#ef4444" : val > 8 ? "#f59e0b" : "#00e676" }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={40}
                        step={1}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer"
                        style={{ accentColor: val > 15 ? "#ef4444" : val > 8 ? "#f59e0b" : "#00e676" }}
                        value={val}
                        onChange={(event) =>
                          setPenaltyWeights((current) => ({
                            ...current,
                            [field.key]: Number(event.target.value)
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}

              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div
                  className="text-xs font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}
                >
                  Formula obiettivo
                </div>
                <code
                  className="text-xs break-all"
                  style={{ color: "rgba(0,230,118,0.7)", fontFamily: "monospace" }}
                >
                  minimize: {objectiveFormula}
                </code>
              </div>
            </div>
          )}

          {/* Footer navigation */}
          <footer className="mt-6 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <button
              type="button"
              className="sport-btn-secondary"
              onClick={prevStep}
              disabled={step === 0 || saving || loadingEdit}
            >
              Indietro
            </button>

            <div className="flex gap-2">
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  className="sport-btn-primary"
                  onClick={nextStep}
                  disabled={saving || loadingEdit}
                >
                  Avanti
                </button>
              ) : (
                <button
                  type="button"
                  className="sport-btn-primary"
                  onClick={() => void submit()}
                  disabled={saving || loadingEdit}
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Salvataggio...
                    </span>
                  ) : mode === "edit" ? "Aggiorna torneo" : createAsPair ? "Crea coppia M/F" : "Salva torneo"}
                </button>
              )}
            </div>
          </footer>
        </section>

        {/* Summary sidebar */}
        <aside
          className="rounded-xl p-4 h-fit space-y-4"
          style={cardStyle}
        >
          <h2
            className="font-bold text-sm uppercase tracking-widest"
            style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}
          >
            Riepilogo
          </h2>
          <div className="space-y-3 text-sm">
            {[
              { label: "Modalita", value: mode === "edit" ? "Modifica" : createAsPair ? "Coppia M/F" : "Singolo" },
              { label: "Torneo", value: `${name || "—"} ${year}` },
              ...(mode !== "edit" && createAsPair
                ? [{ label: "Max sq. M/F", value: `${maleMaxTeams} / ${femaleMaxTeams}` }]
                : []),
              { label: "Giorni", value: String(totalDays) },
              { label: "Finals days", value: summary.finalsDaysLabel },
              { label: "Slot stimati", value: String(summary.totalSlots) },
              { label: "Formato", value: `${teamsPerGroup} per girone, ${teamsAdvancingPerGroup} qualif.` },
              { label: "Wild card", value: wildcardEnabled ? String(wildcardCount) : "Off" }
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-2">
                <span className="text-xs flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
                <span className="text-xs text-right font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>{value}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
