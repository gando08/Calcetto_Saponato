import { useState } from "react";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";

type TimeWindowInput = {
  start: string;
  end: string;
};

type DayInput = {
  label: string;
  date: string;
  is_finals_day: boolean;
  windows: TimeWindowInput[];
};

const DEFAULT_TIEBREAKERS = "head_to_head,goal_diff,goals_for,goals_against,fair_play,draw";

export function TournamentSetup() {
  const { setCurrent } = useTournamentStore();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState("Torneo Calcetto Saponato");
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [maxTeams, setMaxTeams] = useState<number | "">(16);
  const [totalDays, setTotalDays] = useState(4);
  const [matchDuration, setMatchDuration] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [teamsPerGroup, setTeamsPerGroup] = useState(4);
  const [teamsAdvancingPerGroup, setTeamsAdvancingPerGroup] = useState(2);
  const [wildcardEnabled, setWildcardEnabled] = useState(false);
  const [wildcardCount, setWildcardCount] = useState(0);

  const [pointsWin, setPointsWin] = useState(3);
  const [pointsDraw, setPointsDraw] = useState(1);
  const [pointsLoss, setPointsLoss] = useState(0);
  const [tiebreakers, setTiebreakers] = useState(DEFAULT_TIEBREAKERS);

  const [days, setDays] = useState<DayInput[]>([
    {
      label: "Giorno 1",
      date: "",
      is_finals_day: false,
      windows: [{ start: "10:00", end: "13:00" }]
    }
  ]);

  const nextStep = () => setStep((s) => Math.min(s + 1, 3));
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  const addDay = () => {
    setDays((curr) => [
      ...curr,
      {
        label: `Giorno ${curr.length + 1}`,
        date: "",
        is_finals_day: false,
        windows: [{ start: "10:00", end: "13:00" }]
      }
    ]);
  };

  const removeDay = (idx: number) => {
    setDays((curr) => curr.filter((_, i) => i !== idx));
  };

  const updateDay = <K extends keyof DayInput>(idx: number, key: K, value: DayInput[K]) => {
    setDays((curr) => curr.map((day, i) => (i === idx ? { ...day, [key]: value } : day)));
  };

  const addWindow = (dayIdx: number) => {
    setDays((curr) =>
      curr.map((day, i) =>
        i === dayIdx ? { ...day, windows: [...day.windows, { start: "15:00", end: "18:00" }] } : day
      )
    );
  };

  const removeWindow = (dayIdx: number, winIdx: number) => {
    setDays((curr) =>
      curr.map((day, i) =>
        i === dayIdx ? { ...day, windows: day.windows.filter((_, w) => w !== winIdx) } : day
      )
    );
  };

  const updateWindow = (dayIdx: number, winIdx: number, key: keyof TimeWindowInput, value: string) => {
    setDays((curr) =>
      curr.map((day, i) =>
        i === dayIdx
          ? {
              ...day,
              windows: day.windows.map((w, wi) => (wi === winIdx ? { ...w, [key]: value } : w))
            }
          : day
      )
    );
  };

  const validateBeforeSubmit = () => {
    if (!name.trim()) return "Il nome torneo è obbligatorio.";
    if (days.length === 0) return "Aggiungi almeno un giorno.";
    for (const day of days) {
      if (!day.label.trim() || !day.date) return "Ogni giorno deve avere etichetta e data.";
      const validWindows = day.windows.filter((w) => w.start && w.end && w.start < w.end);
      if (validWindows.length === 0) return `Il giorno "${day.label}" deve avere almeno una finestra valida.`;
    }
    return null;
  };

  const submit = async () => {
    setError(null);
    setSuccess(null);
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const tiebreakerOrder = tiebreakers
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      const tournament = await tournamentApi.create({
        name,
        gender: gender || null,
        max_teams: gender && maxTeams !== "" ? Number(maxTeams) : null,
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
        tiebreaker_order: tiebreakerOrder,
        penalty_weights: {}
      });

      for (const day of days) {
        const timeWindows = day.windows.filter((w) => w.start && w.end && w.start < w.end);
        await tournamentApi.addDay(tournament.id, {
          date: day.date,
          label: day.label,
          is_finals_day: day.is_finals_day,
          time_windows: timeWindows
        });
      }

      setCurrent(tournament);
      setSuccess(`Torneo creato con successo (ID: ${tournament.id}).`);
      setStep(3);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Errore durante il salvataggio.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-lg shadow p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Configurazione Torneo</h1>
        <p className="text-slate-600">Wizard operativo: Setup base, punteggi, giorni e riepilogo.</p>
      </header>

      <div className="flex gap-2 text-sm">
        {["Dati base", "Punteggi", "Giorni", "Riepilogo"].map((label, idx) => (
          <div
            key={label}
            className={`px-3 py-1 rounded-full border ${idx === step ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            {idx + 1}. {label}
          </div>
        ))}
      </div>

      {error ? <div className="bg-red-100 text-red-800 border border-red-300 rounded p-3">{error}</div> : null}
      {success ? <div className="bg-green-100 text-green-800 border border-green-300 rounded p-3">{success}</div> : null}

      {step === 0 ? (
        <section className="grid md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm font-medium">Nome torneo</span>
            <input className="border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          {/* ── Genere torneo ── */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Genere torneo</span>
            <select
              className="border rounded px-3 py-2"
              value={gender}
              onChange={(e) => {
                const g = e.target.value as "" | "M" | "F";
                setGender(g);
                if (g === "M") setMaxTeams(16);
                else if (g === "F") setMaxTeams(6);
                else setMaxTeams("");
              }}
            >
              <option value="">Misto / non specificato</option>
              <option value="M">Maschile (M)</option>
              <option value="F">Femminile (F)</option>
            </select>
          </label>
          {gender ? (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Max squadre</span>
              <input
                type="number"
                min={2}
                className="border rounded px-3 py-2"
                value={maxTeams}
                onChange={(e) => setMaxTeams(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </label>
          ) : <div />}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Giorni previsti</span>
            <input
              type="number"
              min={1}
              className="border rounded px-3 py-2"
              value={totalDays}
              onChange={(e) => setTotalDays(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Durata partita (min)</span>
            <input
              type="number"
              min={5}
              className="border rounded px-3 py-2"
              value={matchDuration}
              onChange={(e) => setMatchDuration(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Buffer (min)</span>
            <input
              type="number"
              min={0}
              className="border rounded px-3 py-2"
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Squadre per girone</span>
            <input
              type="number"
              min={2}
              className="border rounded px-3 py-2"
              value={teamsPerGroup}
              onChange={(e) => setTeamsPerGroup(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Qualificate per girone</span>
            <input
              type="number"
              min={1}
              className="border rounded px-3 py-2"
              value={teamsAdvancingPerGroup}
              onChange={(e) => setTeamsAdvancingPerGroup(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={wildcardEnabled} onChange={(e) => setWildcardEnabled(e.target.checked)} />
            <span className="text-sm font-medium">Abilita wild card</span>
          </label>
          {wildcardEnabled ? (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Numero wild card</span>
              <input
                type="number"
                min={0}
                className="border rounded px-3 py-2"
                value={wildcardCount}
                onChange={(e) => setWildcardCount(Number(e.target.value))}
              />
            </label>
          ) : null}
        </section>
      ) : null}

      {step === 1 ? (
        <section className="grid md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Punti vittoria</span>
            <input
              type="number"
              className="border rounded px-3 py-2"
              value={pointsWin}
              onChange={(e) => setPointsWin(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Punti pareggio</span>
            <input
              type="number"
              className="border rounded px-3 py-2"
              value={pointsDraw}
              onChange={(e) => setPointsDraw(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Punti sconfitta</span>
            <input
              type="number"
              className="border rounded px-3 py-2"
              value={pointsLoss}
              onChange={(e) => setPointsLoss(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-3">
            <span className="text-sm font-medium">Ordine tiebreakers (CSV)</span>
            <input
              className="border rounded px-3 py-2"
              value={tiebreakers}
              onChange={(e) => setTiebreakers(e.target.value)}
            />
          </label>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          {days.map((day, dIdx) => (
            <div key={`${day.label}-${dIdx}`} className="border rounded p-4 space-y-3">
              <div className="grid md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Label</span>
                  <input
                    className="border rounded px-3 py-2"
                    value={day.label}
                    onChange={(e) => updateDay(dIdx, "label", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Data</span>
                  <input
                    type="date"
                    className="border rounded px-3 py-2"
                    value={day.date}
                    onChange={(e) => updateDay(dIdx, "date", e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 mt-7">
                  <input
                    type="checkbox"
                    checked={day.is_finals_day}
                    onChange={(e) => updateDay(dIdx, "is_finals_day", e.target.checked)}
                  />
                  <span className="text-sm">Giorno finali</span>
                </label>
              </div>

              <div className="space-y-2">
                {day.windows.map((w, wIdx) => (
                  <div key={`w-${wIdx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      type="time"
                      className="border rounded px-3 py-2"
                      value={w.start}
                      onChange={(e) => updateWindow(dIdx, wIdx, "start", e.target.value)}
                    />
                    <input
                      type="time"
                      className="border rounded px-3 py-2"
                      value={w.end}
                      onChange={(e) => updateWindow(dIdx, wIdx, "end", e.target.value)}
                    />
                    <button
                      className="px-3 py-2 border rounded text-red-700"
                      onClick={() => removeWindow(dIdx, wIdx)}
                      type="button"
                    >
                      Rimuovi
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button className="px-3 py-2 border rounded" type="button" onClick={() => addWindow(dIdx)}>
                  + Finestra
                </button>
                <button className="px-3 py-2 border rounded text-red-700" type="button" onClick={() => removeDay(dIdx)}>
                  Elimina giorno
                </button>
              </div>
            </div>
          ))}

          <button className="px-3 py-2 border rounded" type="button" onClick={addDay}>
            + Aggiungi giorno
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-2 text-sm">
          <div>
            <strong>Torneo:</strong> {name}
          </div>
          {gender ? (
            <div>
              <strong>Genere:</strong>{" "}
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${gender === "M" ? "bg-blue-100 text-blue-800" : "bg-pink-100 text-pink-800"}`}>
                {gender === "M" ? "Maschile" : "Femminile"}
              </span>
              {maxTeams ? ` — max ${maxTeams} squadre` : ""}
            </div>
          ) : null}
          <div>
            <strong>Durata partita:</strong> {matchDuration} min (+{bufferMinutes} min buffer)
          </div>
          <div>
            <strong>Gironi:</strong> {teamsPerGroup} squadre, {teamsAdvancingPerGroup} qualificate
          </div>
          <div>
            <strong>Giorni configurati:</strong> {days.length}
          </div>
          <div>
            <strong>Tiebreakers:</strong> {tiebreakers}
          </div>
        </section>
      ) : null}

      <footer className="flex justify-between pt-2">
        <button
          className="px-4 py-2 border rounded disabled:opacity-50"
          onClick={prevStep}
          disabled={step === 0 || saving}
          type="button"
        >
          Indietro
        </button>
        <div className="flex gap-2">
          {step < 3 ? (
            <button className="px-4 py-2 border rounded" type="button" onClick={nextStep} disabled={saving}>
              Avanti
            </button>
          ) : null}
          <button className="px-4 py-2 bg-slate-900 text-white rounded disabled:opacity-50" onClick={submit} disabled={saving} type="button">
            {saving ? "Salvataggio..." : "Salva Torneo"}
          </button>
        </div>
      </footer>
    </div>
  );
}
