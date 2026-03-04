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
  "fair_play",
  "draw"
];

const TIEBREAKER_LABELS: Record<string, string> = {
  head_to_head: "Scontro Diretto",
  goal_diff: "Differenza Reti",
  goals_for: "Gol Fatti",
  goals_against: "Gol Subiti",
  fair_play: "Fair Play",
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
        transition
      }}
      {...attributes}
      {...listeners}
      className={`rounded-lg border px-3 py-2 text-sm bg-white cursor-grab ${isDragging ? "shadow-md opacity-70" : ""}`}
    >
      <span className="text-xs text-slate-500 mr-2">drag</span>
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

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Configurazione Torneo</h1>
        <p className="text-sm text-slate-600">Puoi creare un nuovo torneo o modificare quello esistente.</p>
      </header>

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Torneo attivo</span>
            <select
              className="rounded-lg border px-3 py-2 min-w-64"
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

          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              type="button"
              className={`px-4 py-2 text-sm ${mode === "create" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
              onClick={() => {
                setMode("create");
                setError(null);
                setSuccess(null);
                resetCreateForm();
              }}
            >
              Nuovo torneo
            </button>
            <button
              type="button"
              className={`px-4 py-2 text-sm ${mode === "edit" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
              onClick={() => {
                setMode("edit");
                setError(null);
                setSuccess(null);
                setLoadedTournamentId("");
              }}
              disabled={!current?.id}
            >
              Modifica torneo
            </button>
          </div>

          <button
            type="button"
            className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => void onDeleteCurrentTournament()}
            disabled={!current?.id || deleteTournamentMutation.isPending}
          >
            {deleteTournamentMutation.isPending ? "Eliminazione..." : "Elimina torneo"}
          </button>

          <button
            type="button"
            className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => void onDeleteCurrentPair()}
            disabled={!currentPair || deleteTournamentMutation.isPending}
          >
            Elimina coppia M/F
          </button>
        </div>
        <div className="text-xs text-slate-500">
          Coppie M/F rilevate: <strong>{tournamentPairs.length}</strong>
          {currentPair ? ` - corrente: ${currentPair.label}` : ""}
        </div>
      </section>

      <ol className="grid gap-2 md:grid-cols-4">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-lg border px-3 py-2 text-sm ${
              index === step ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700"
            }`}
          >
            <span className="font-semibold mr-2">{index + 1}.</span>
            {label}
          </li>
        ))}
      </ol>

      {error ? <div className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-red-700 text-sm">{error}</div> : null}
      {success ? (
        <div className="rounded-lg border border-green-300 bg-green-100 px-3 py-2 text-green-700 text-sm">{success}</div>
      ) : null}
      {loadingEdit ? (
        <div className="rounded-lg border bg-slate-100 px-3 py-2 text-slate-700 text-sm">Caricamento configurazione torneo...</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          {step === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-sm font-medium">Nome torneo</span>
                <input className="rounded-lg border px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Anno</span>
                <input
                  type="number"
                  className="rounded-lg border px-3 py-2"
                  value={year}
                  min={2020}
                  max={2100}
                  onChange={(event) => setYear(Number(event.target.value))}
                />
              </label>

              {mode === "create" ? (
                <label className="inline-flex items-center gap-2 text-sm mt-6">
                  <input
                    type="checkbox"
                    checked={createAsPair}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setCreateAsPair(checked);
                      if (checked) {
                        setGender("");
                      }
                    }}
                  />
                  Crea coppia tornei M/F (gestione centralizzata)
                </label>
              ) : (
                <div className="text-xs text-slate-500 mt-6">Modifica torneo singolo.</div>
              )}

              {createAsPair && mode === "create" ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Max squadre Maschile (M)</span>
                    <input
                      type="number"
                      min={2}
                      className="rounded-lg border px-3 py-2"
                      value={maleMaxTeams}
                      onChange={(event) => setMaleMaxTeams(Math.max(2, Number(event.target.value) || 2))}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Max squadre Femminile (F)</span>
                    <input
                      type="number"
                      min={2}
                      className="rounded-lg border px-3 py-2"
                      value={femaleMaxTeams}
                      onChange={(event) => setFemaleMaxTeams(Math.max(2, Number(event.target.value) || 2))}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Genere torneo</span>
                    <select
                      className="rounded-lg border px-3 py-2"
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

                  {gender ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Numero max squadre</span>
                      <input
                        type="number"
                        min={2}
                        className="rounded-lg border px-3 py-2"
                        value={maxTeams}
                        onChange={(event) => setMaxTeams(event.target.value === "" ? "" : Number(event.target.value))}
                      />
                    </label>
                  ) : null}
                </>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Numero giorni torneo</span>
                <input
                  type="number"
                  min={1}
                  className="rounded-lg border px-3 py-2"
                  value={totalDays}
                  onChange={(event) => setTotalDays(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Durata match (min)</span>
                <input
                  type="number"
                  min={5}
                  className="rounded-lg border px-3 py-2"
                  value={matchDuration}
                  onChange={(event) => setMatchDuration(Math.max(5, Number(event.target.value) || 5))}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Buffer tra match (min)</span>
                <input
                  type="number"
                  min={0}
                  className="rounded-lg border px-3 py-2"
                  value={bufferMinutes}
                  onChange={(event) => setBufferMinutes(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>

              <div className="md:col-span-2 space-y-2">
                <div className="text-sm font-medium">Finals Days (multi-select)</div>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: totalDays }, (_, index) => index + 1).map((dayNumber) => (
                    <label key={dayNumber} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={finalsDays.includes(dayNumber)}
                        onChange={(event) => toggleFinalsDay(dayNumber, event.target.checked)}
                      />
                      Giorno {dayNumber}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              {days.map((day, dayIndex) => {
                const preview = slotPreview[dayIndex]?.slots ?? [];
                return (
                  <article key={`day-${dayIndex}`} className="rounded-lg border p-3 space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-sm font-medium">Etichetta</span>
                        <input
                          className="rounded-lg border px-3 py-2"
                          value={day.label}
                          onChange={(event) => updateDay(dayIndex, "label", event.target.value)}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-sm font-medium">Data</span>
                        <input
                          type="date"
                          className="rounded-lg border px-3 py-2"
                          value={day.date}
                          onChange={(event) => updateDay(dayIndex, "date", event.target.value)}
                        />
                      </label>
                      <label className="inline-flex items-center gap-2 mt-7 text-sm">
                        <input
                          type="checkbox"
                          checked={finalsDays.includes(dayIndex + 1)}
                          onChange={(event) => toggleFinalsDay(dayIndex + 1, event.target.checked)}
                        />
                        Giorno finali
                      </label>
                    </div>

                    <div className="space-y-2">
                      {day.windows.map((window, windowIndex) => (
                        <div key={`window-${windowIndex}`} className="grid gap-2 grid-cols-[1fr_1fr_auto]">
                          <input
                            type="time"
                            className="rounded-lg border px-3 py-2"
                            value={window.start}
                            onChange={(event) => updateWindow(dayIndex, windowIndex, "start", event.target.value)}
                          />
                          <input
                            type="time"
                            className="rounded-lg border px-3 py-2"
                            value={window.end}
                            onChange={(event) => updateWindow(dayIndex, windowIndex, "end", event.target.value)}
                          />
                          <button
                            type="button"
                            className="rounded-lg border px-3 py-2 text-red-700 disabled:opacity-50"
                            onClick={() => removeWindow(dayIndex, windowIndex)}
                            disabled={day.windows.length === 1}
                          >
                            Rimuovi
                          </button>
                        </div>
                      ))}
                    </div>

                    <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => addWindow(dayIndex)}>
                      + Aggiungi fascia oraria
                    </button>

                    <div className="rounded-lg bg-slate-50 border px-3 py-2 text-sm">
                      <div className="font-medium">Preview slot: {preview.length}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {preview.length > 0 ? (
                          preview.map((slot) => (
                            <span key={`${slot.start_time}-${slot.end_time}`} className="rounded bg-white border px-2 py-0.5 text-xs">
                              {slot.start_time}-{slot.end_time}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500">Nessuno slot generato con i parametri correnti.</span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Squadre per girone</span>
                  <input
                    type="number"
                    min={2}
                    className="rounded-lg border px-3 py-2"
                    value={teamsPerGroup}
                    onChange={(event) => setTeamsPerGroup(Math.max(2, Number(event.target.value) || 2))}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Squadre che avanzano</span>
                  <input
                    type="number"
                    min={1}
                    className="rounded-lg border px-3 py-2"
                    value={teamsAdvancingPerGroup}
                    onChange={(event) => setTeamsAdvancingPerGroup(Math.max(1, Number(event.target.value) || 1))}
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={wildcardEnabled} onChange={(event) => setWildcardEnabled(event.target.checked)} />
                  Wild card abilitata
                </label>

                {wildcardEnabled ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Numero wild card</span>
                    <input
                      type="number"
                      min={0}
                      className="rounded-lg border px-3 py-2"
                      value={wildcardCount}
                      onChange={(event) => setWildcardCount(Math.max(0, Number(event.target.value) || 0))}
                    />
                  </label>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Punti vittoria</span>
                  <input
                    type="number"
                    className="rounded-lg border px-3 py-2"
                    value={pointsWin}
                    onChange={(event) => setPointsWin(Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Punti pareggio</span>
                  <input
                    type="number"
                    className="rounded-lg border px-3 py-2"
                    value={pointsDraw}
                    onChange={(event) => setPointsDraw(Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Punti sconfitta</span>
                  <input
                    type="number"
                    className="rounded-lg border px-3 py-2"
                    value={pointsLoss}
                    onChange={(event) => setPointsLoss(Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Criteri spareggio (drag & drop)</h3>
                  <button
                    type="button"
                    className="rounded-lg border px-3 py-1.5 text-sm"
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
                              className="rounded border px-2 text-xs"
                              onClick={() => moveTiebreaker(index, -1)}
                              disabled={index === 0}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 text-xs"
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
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              {PENALTY_FIELDS.map((field) => (
                <div key={field.key} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="font-medium">{field.label}</div>
                      <p className="text-xs text-slate-500">{field.description}</p>
                    </div>
                    <span className="rounded bg-slate-900 text-white px-2 py-0.5 text-xs">{penaltyWeights[field.key]}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    className="w-full"
                    value={penaltyWeights[field.key]}
                    onChange={(event) =>
                      setPenaltyWeights((current) => ({
                        ...current,
                        [field.key]: Number(event.target.value)
                      }))
                    }
                  />
                </div>
              ))}

              <div className="rounded-lg border bg-slate-50 px-3 py-2">
                <div className="text-sm font-medium">Preview formula obiettivo</div>
                <code className="text-xs text-slate-700 break-all">minimize: {objectiveFormula}</code>
              </div>
            </div>
          ) : null}

          <footer className="mt-6 pt-4 border-t flex items-center justify-between">
            <button
              type="button"
              className="rounded-lg border px-4 py-2 disabled:opacity-50"
              onClick={prevStep}
              disabled={step === 0 || saving || loadingEdit}
            >
              Indietro
            </button>

            <div className="flex gap-2">
              {step < STEPS.length - 1 ? (
                <button type="button" className="rounded-lg border px-4 py-2" onClick={nextStep} disabled={saving || loadingEdit}>
                  Avanti
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg bg-slate-900 text-white px-4 py-2 disabled:opacity-50"
                  onClick={() => void submit()}
                  disabled={saving || loadingEdit}
                >
                  {saving ? "Salvataggio..." : mode === "edit" ? "Aggiorna torneo" : createAsPair ? "Crea coppia M/F" : "Salva torneo"}
                </button>
              )}
            </div>
          </footer>
        </section>

        <aside className="rounded-xl border bg-white p-4 shadow-sm h-fit space-y-3">
          <h2 className="font-semibold">Riepilogo Rapido</h2>
          <div className="text-sm space-y-1">
            <div>
              <span className="text-slate-500">Modalita:</span>{" "}
              {mode === "edit" ? "Modifica" : createAsPair ? "Creazione coppia M/F" : "Creazione singolo"}
            </div>
            <div>
              <span className="text-slate-500">Torneo:</span> {name || "-"} {year}
            </div>
            {mode !== "edit" && createAsPair ? (
              <div>
                <span className="text-slate-500">Max squadre M/F:</span> {maleMaxTeams} / {femaleMaxTeams}
              </div>
            ) : null}
            <div>
              <span className="text-slate-500">Giorni:</span> {totalDays}
            </div>
            <div>
              <span className="text-slate-500">Finals days:</span> {summary.finalsDaysLabel}
            </div>
            <div>
              <span className="text-slate-500">Slot stimati:</span> {summary.totalSlots}
            </div>
            <div>
              <span className="text-slate-500">Formato:</span> {teamsPerGroup} per girone, {teamsAdvancingPerGroup} qualificate
            </div>
            <div>
              <span className="text-slate-500">Wild card:</span> {wildcardEnabled ? `${wildcardCount}` : "Off"}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
