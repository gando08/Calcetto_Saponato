import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, teamApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Slot, Team, Tournament, TournamentDay } from "../types";
import { buildTournamentPairs, getTournamentIdForGender } from "../utils/tournamentPairs";

type TeamFormState = {
  name: string;
  gender: "M" | "F";
  preferred_days: string[];
  preferred_windows_csv: string;
  unavailable_slot_ids: string[];
  prefers_consecutive: boolean;
};

type CsvPreview = {
  headers: string[];
  rows: string[][];
};

const EMPTY_FORM: TeamFormState = {
  name: "",
  gender: "M",
  preferred_days: [],
  preferred_windows_csv: "",
  unavailable_slot_ids: [],
  prefers_consecutive: false
};

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
      continue;
    }

    value += char;
  }

  cells.push(value.trim());
  return cells;
}

function parsePreferredWindows(csv: string) {
  return csv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [start, end] = entry.split("-").map((value) => value.trim());
      return { start, end };
    })
    .filter((window) => window.start && window.end);
}

function serializePreferredWindows(windows: Array<{ start: string; end: string }>) {
  return windows.map((window) => `${window.start}-${window.end}`).join(", ");
}

function normalizeToken(value: string) {
  return (value || "").trim().toLowerCase();
}

function mapPreferredDaysToLabels(preferredDays: string[], days: TournamentDay[]) {
  if (!preferredDays?.length || !days?.length) return preferredDays || [];
  return [...new Set(preferredDays.map((token) => {
    const normalized = normalizeToken(token);
    const matched = days.find((day) => {
      return normalizeToken(day.id) === normalized || normalizeToken(day.label) === normalized || normalizeToken(day.date) === normalized;
    });
    return matched ? matched.label : token;
  }))];
}

function teamToForm(team: Team, days: TournamentDay[]): TeamFormState {
  return {
    name: team.name,
    gender: team.gender,
    preferred_days: mapPreferredDaysToLabels(team.preferred_days || [], days),
    preferred_windows_csv: serializePreferredWindows(
      (team.preferred_time_windows || []) as Array<{ start: string; end: string }>
    ),
    unavailable_slot_ids: team.unavailable_slot_ids || [],
    prefers_consecutive: team.prefers_consecutive
  };
}

function formToPayload(form: TeamFormState) {
  return {
    name: form.name.trim(),
    gender: form.gender,
    preferred_days: form.preferred_days,
    preferred_time_windows: parsePreferredWindows(form.preferred_windows_csv),
    unavailable_slot_ids: form.unavailable_slot_ids,
    prefers_consecutive: form.prefers_consecutive
  };
}

function groupSlotsByDay(slots: Slot[]) {
  const grouped = new Map<string, Slot[]>();
  for (const slot of slots) {
    const list = grouped.get(slot.day_label) ?? [];
    list.push(slot);
    grouped.set(slot.day_label, list);
  }
  return grouped;
}

type SlotPickerProps = {
  slots: Slot[];
  selected: string[];
  onChange: (ids: string[]) => void;
};

function SlotPicker({ slots, selected, onChange }: SlotPickerProps) {
  const byDay = useMemo(() => groupSlotsByDay(slots), [slots]);

  if (slots.length === 0) {
    return <p className="text-sm text-slate-500 italic">Nessuno slot disponibile. Configura prima i giorni del torneo.</p>;
  }

  const toggleSlot = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  const toggleDay = (daySlots: Slot[]) => {
    const dayIds = daySlots.map((slot) => slot.id);
    const allSelected = dayIds.every((id) => selected.includes(id));
    if (allSelected) {
      onChange(selected.filter((id) => !dayIds.includes(id)));
      return;
    }
    const next = new Set([...selected, ...dayIds]);
    onChange([...next]);
  };

  return (
    <div className="border rounded-lg divide-y max-h-64 overflow-y-auto text-sm">
      {[...byDay.entries()].map(([dayLabel, daySlots]) => {
        const dayIds = daySlots.map((slot) => slot.id);
        const allSelected = dayIds.every((id) => selected.includes(id));
        const someSelected = !allSelected && dayIds.some((id) => selected.includes(id));

        return (
          <div key={dayLabel} className="p-2">
            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = someSelected;
                }}
                onChange={() => toggleDay(daySlots)}
              />
              {dayLabel}
            </label>
            <div className="ml-6 mt-1 flex flex-wrap gap-2">
              {daySlots.map((slot) => (
                <label key={slot.id} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(slot.id)} onChange={() => toggleSlot(slot.id)} />
                  <span className="text-slate-700">
                    {slot.start_time}-{slot.end_time}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Teams() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();

  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [genderFilter, setGenderFilter] = useState<"ALL" | "M" | "F">("ALL");
  const [importGender, setImportGender] = useState<"M" | "F">("M");
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });

  const tournaments = (tournamentsQuery.data || []) as Tournament[];
  const pairs = useMemo(() => buildTournamentPairs(tournaments), [tournaments]);
  const selectedPair = useMemo(() => pairs.find((pair) => pair.key === selectedPairKey) ?? null, [pairs, selectedPairKey]);

  useEffect(() => {
    if (!pairs.length) {
      if (selectedPairKey) setSelectedPairKey("");
      return;
    }
    if (selectedPairKey && pairs.some((pair) => pair.key === selectedPairKey)) return;
    const pairFromCurrent = current
      ? pairs.find((pair) => pair.male?.id === current.id || pair.female?.id === current.id)
      : null;
    setSelectedPairKey((pairFromCurrent || pairs[0]).key);
  }, [current?.id, pairs, selectedPairKey]);

  useEffect(() => {
    if (!selectedPair) return;
    const fallback = selectedPair.male || selectedPair.female;
    if (fallback && current?.id !== fallback.id) {
      setCurrent(fallback);
    }
  }, [current?.id, selectedPair, setCurrent]);

  useEffect(() => {
    if (!selectedPair) return;
    if (importGender === "M" && !selectedPair.male && selectedPair.female) {
      setImportGender("F");
    }
    if (importGender === "F" && !selectedPair.female && selectedPair.male) {
      setImportGender("M");
    }
  }, [importGender, selectedPair]);

  const maleTid = selectedPair?.male?.id || "";
  const femaleTid = selectedPair?.female?.id || "";
  const importTid = importGender === "M" ? maleTid : femaleTid;

  const teamsMaleQuery = useQuery({
    queryKey: ["teams", maleTid],
    queryFn: () => teamApi.list(maleTid),
    enabled: Boolean(maleTid)
  });
  const teamsFemaleQuery = useQuery({
    queryKey: ["teams", femaleTid],
    queryFn: () => teamApi.list(femaleTid),
    enabled: Boolean(femaleTid)
  });

  const targetTid = useMemo(() => {
    if (editingTeam?.tournament_id) return editingTeam.tournament_id;
    return getTournamentIdForGender(selectedPair, form.gender) || "";
  }, [editingTeam?.tournament_id, form.gender, selectedPair]);

  const slotsQuery = useQuery({
    queryKey: ["slots", targetTid],
    queryFn: () => tournamentApi.getSlots(targetTid),
    enabled: Boolean(targetTid) && drawerOpen
  });
  const daysQuery = useQuery({
    queryKey: ["days", targetTid],
    queryFn: () => tournamentApi.getDays(targetTid),
    enabled: Boolean(targetTid) && drawerOpen
  });

  const createMutation = useMutation({
    mutationFn: ({ tid, payload }: { tid: string; payload: unknown }) => teamApi.create(tid, payload),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["teams", variables.tid] })
  });

  const updateMutation = useMutation({
    mutationFn: ({ tid, id, payload }: { tid: string; id: string; payload: unknown }) => teamApi.update(tid, id, payload),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["teams", variables.tid] })
  });

  const deleteMutation = useMutation({
    mutationFn: ({ tid, id }: { tid: string; id: string }) => teamApi.delete(tid, id),
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ["teams", variables.tid] })
  });

  const importMutation = useMutation({
    mutationFn: ({ tid, file }: { tid: string; file: File }) => teamApi.import(tid, file),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["teams", variables.tid] });
    }
  });

  const teams = useMemo(() => {
    const all = [ ...((teamsMaleQuery.data || []) as Team[]), ...((teamsFemaleQuery.data || []) as Team[]) ];
    return all.sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [teamsFemaleQuery.data, teamsMaleQuery.data]);
  const slots = (slotsQuery.data || []) as Slot[];
  const days = (daysQuery.data || []) as TournamentDay[];
  const nonFinalDays = days.filter((day) => !day.is_finals_day);
  const teamsLoading = (maleTid ? teamsMaleQuery.isLoading : false) || (femaleTid ? teamsFemaleQuery.isLoading : false);

  const filteredTeams = useMemo(() => {
    if (genderFilter === "ALL") return teams;
    return teams.filter((team) => team.gender === genderFilter);
  }, [genderFilter, teams]);

  const maleCount = teams.filter((team) => team.gender === "M").length;
  const femaleCount = teams.filter((team) => team.gender === "F").length;

  const csvTemplateUrl = importTid
    ? `${String(api.defaults.baseURL ?? "http://localhost:8000")}/api/tournaments/${importTid}/teams/csv-template`
    : "";
  const tournamentsById = useMemo(() => new Map(tournaments.map((tournament) => [tournament.id, tournament])), [tournaments]);

  const openCreate = () => {
    setEditingTeam(null);
    setForm({ ...EMPTY_FORM, gender: maleTid ? "M" : "F" });
    setErrorMessage(null);
    setDrawerOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditingTeam(team);
    setForm(teamToForm(team, []));
    setErrorMessage(null);
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen || !days.length) return;
    setForm((currentForm) => ({
      ...currentForm,
      preferred_days: mapPreferredDaysToLabels(currentForm.preferred_days, days)
    }));
  }, [days, drawerOpen]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingTeam(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async () => {
    if (!form.name.trim()) {
      setErrorMessage("Inserisci il nome squadra.");
      return;
    }
    if (!targetTid) {
      setErrorMessage(form.gender === "M" ? "Manca il torneo maschile." : "Manca il torneo femminile.");
      return;
    }

    setErrorMessage(null);
    const payload = formToPayload(form);
    try {
      if (editingTeam) {
        await updateMutation.mutateAsync({ tid: targetTid, id: editingTeam.id, payload });
      } else {
        await createMutation.mutateAsync({ tid: targetTid, payload });
      }
      closeDrawer();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante il salvataggio.");
    }
  };

  const onDeleteTeam = async (team: Team) => {
    if (!confirm("Eliminare questa squadra?")) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync({ tid: team.tournament_id, id: team.id });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante eliminazione squadra.");
    }
  };

  const clearImportState = () => {
    setCsvFile(null);
    setCsvPreview(null);
    setCsvLoading(false);
  };

  const onSelectCsv = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage("Seleziona un file .csv.");
      return;
    }

    setCsvFile(file);
    setCsvLoading(true);
    setErrorMessage(null);

    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        setCsvPreview({ headers: [], rows: [] });
        return;
      }

      const headers = splitCsvLine(lines[0]);
      const rows = lines.slice(1).map((line) => splitCsvLine(line));
      setCsvPreview({ headers, rows });
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore lettura file CSV.");
      clearImportState();
    } finally {
      setCsvLoading(false);
    }
  };

  const confirmImportCsv = async () => {
    if (!csvFile) {
      setErrorMessage("Seleziona un file CSV da importare.");
      return;
    }
    if (!importTid) {
      setErrorMessage(importGender === "M" ? "Manca il torneo maschile." : "Manca il torneo femminile.");
      return;
    }

    setErrorMessage(null);
    try {
      await importMutation.mutateAsync({ tid: importTid, file: csvFile });
      clearImportState();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore import CSV.");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Squadre</h1>
        <p className="text-slate-600 text-sm">Gestione centralizzata squadre M/F con instradamento automatico per genere.</p>
      </header>

      {errorMessage ? <div className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-red-700 text-sm">{errorMessage}</div> : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Coppia tornei M/F</span>
            <select
              className="rounded-lg border px-3 py-2 min-w-64"
              value={selectedPairKey}
              onChange={(event) => {
                setSelectedPairKey(event.target.value);
                setErrorMessage(null);
              }}
            >
              {pairs.map((pair) => (
                <option value={pair.key} key={pair.key}>
                  {pair.label}
                </option>
              ))}
            </select>
          </label>

          <button className="rounded-lg bg-slate-900 text-white px-4 py-2" type="button" onClick={openCreate} disabled={!selectedPair}>
            + Aggiungi squadra
          </button>

          <label className="rounded-lg border px-4 py-2 cursor-pointer bg-slate-50 hover:bg-slate-100">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void onSelectCsv(event.target.files?.[0] || null)}
              disabled={!importTid || importMutation.isPending}
            />
            Importa CSV
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Import target</span>
            <select
              className="rounded-lg border px-3 py-2"
              value={importGender}
              onChange={(event) => setImportGender(event.target.value as "M" | "F")}
            >
              <option value="M">Maschile (M)</option>
              <option value="F">Femminile (F)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Filtra</span>
            <select
              className="rounded-lg border px-3 py-2"
              value={genderFilter}
              onChange={(event) => setGenderFilter(event.target.value as "ALL" | "M" | "F")}
            >
              <option value="ALL">Tutti ({maleCount + femaleCount})</option>
              <option value="M">Maschile ({maleCount})</option>
              <option value="F">Femminile ({femaleCount})</option>
            </select>
          </label>

          {csvTemplateUrl ? (
            <a className="rounded-lg border px-4 py-2 bg-slate-50 hover:bg-slate-100" href={csvTemplateUrl} target="_blank" rel="noreferrer">
              Template CSV
            </a>
          ) : null}
        </div>

        {selectedPair ? (
          <div className="text-xs text-slate-500">
            Torneo M: {selectedPair.male?.name || "non configurato"} | Torneo F: {selectedPair.female?.name || "non configurato"}
          </div>
        ) : (
          <div className="text-xs text-amber-700">Nessuna coppia M/F disponibile. Crea prima i tornei in Configurazione.</div>
        )}

        <div
          className={`rounded-xl border-2 border-dashed p-4 text-sm transition-colors ${
            dragActive ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-slate-50"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void onSelectCsv(event.dataTransfer.files?.[0] || null);
          }}
        >
          Trascina qui un file CSV oppure usa il pulsante import.
        </div>

        {csvFile || csvPreview ? (
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">Anteprima import CSV</div>
                <div className="text-slate-500">
                  File: <strong>{csvFile?.name ?? "-"}</strong>
                  {csvPreview ? ` - righe: ${csvPreview.rows.length}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border px-3 py-2 text-sm"
                  onClick={() => clearImportState()}
                  disabled={importMutation.isPending || csvLoading}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => void confirmImportCsv()}
                  disabled={!csvFile || importMutation.isPending || csvLoading}
                >
                  {importMutation.isPending ? "Import in corso..." : "Conferma import"}
                </button>
              </div>
            </div>

            {csvLoading ? (
              <div className="text-sm text-slate-500">Lettura file in corso...</div>
            ) : csvPreview?.headers.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      {csvPreview.headers.map((header, index) => (
                        <th key={`${header}-${index}`} className="text-left px-2 py-1">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.rows.slice(0, 8).map((row, rowIndex) => (
                      <tr key={`preview-${rowIndex}`} className="border-t">
                        {row.map((cell, cellIndex) => (
                          <td key={`${rowIndex}-${cellIndex}`} className="px-2 py-1">
                            {cell || "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvPreview.rows.length > 8 ? (
                  <div className="px-2 py-1 text-xs text-slate-500 border-t">Anteprima limitata a 8 righe.</div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Nessuna riga da mostrare in anteprima.</div>
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Nome</th>
                <th className="text-left px-3 py-2">Genere</th>
                <th className="text-left px-3 py-2">Torneo</th>
                <th className="text-left px-3 py-2">Preferenze</th>
                <th className="text-left px-3 py-2">Indisponibilita</th>
                <th className="text-left px-3 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {teamsLoading ? (
                <tr>
                  <td className="px-3 py-4" colSpan={7}>
                    Caricamento squadre...
                  </td>
                </tr>
              ) : filteredTeams.length === 0 ? (
                <tr>
                  <td className="px-3 py-4" colSpan={7}>
                    Nessuna squadra disponibile.
                  </td>
                </tr>
              ) : (
                filteredTeams.map((team, index) => (
                  <tr key={team.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => openEdit(team)}>
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2 font-medium">{team.name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${team.gender === "M" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}`}>
                        {team.gender}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{tournamentsById.get(team.tournament_id)?.name || "Torneo sconosciuto"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {(team.preferred_days || []).join(", ") || "Nessuna"}
                      <div className="text-xs text-slate-500">
                        {(team.preferred_time_windows || []).map((window) => `${window.start}-${window.end}`).join(", ") || "Nessuna fascia"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {(team.unavailable_slot_ids || []).length > 0 ? `${team.unavailable_slot_ids.length} slot` : "Nessuna"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => openEdit(team)}>
                          Modifica
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs text-red-700"
                          onClick={() => void onDeleteTeam(team)}
                          disabled={deleteMutation.isPending}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 bg-black/30 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full p-5 overflow-y-auto space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{editingTeam ? "Modifica Squadra" : "Nuova Squadra"}</h2>
              <button type="button" className="rounded border px-3 py-1 hover:bg-slate-50" onClick={closeDrawer}>
                X Chiudi
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Nome squadra *</span>
              <input
                className="rounded-lg border px-3 py-2"
                value={form.name}
                placeholder="Es. Team Alpha"
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, name: event.target.value }))}
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Genere</span>
              <select
                className="rounded-lg border px-3 py-2"
                value={form.gender}
                disabled={Boolean(editingTeam)}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, gender: event.target.value as "M" | "F" }))}
              >
                <option value="M">Maschile (M)</option>
                <option value="F">Femminile (F)</option>
              </select>
              {editingTeam ? <span className="text-xs text-slate-500">Il genere non e modificabile in modifica.</span> : null}
              {!targetTid ? (
                <span className="text-xs text-red-600">
                  Nessun torneo disponibile per il genere {form.gender}. Configura prima la coppia M/F.
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  Salvataggio su: {tournamentsById.get(targetTid)?.name || targetTid}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium">Giorni preferiti (escluse finali)</span>
              {daysQuery.isLoading ? (
                <p className="text-sm text-slate-500">Caricamento giorni...</p>
              ) : nonFinalDays.length === 0 ? (
                <p className="text-xs text-slate-500">Nessun giorno selezionabile: i giorni finali non sono ammessi nelle preferenze.</p>
              ) : (
                <div className="rounded-lg border p-2 flex flex-wrap gap-2">
                  {nonFinalDays.map((day) => (
                    <label key={day.id} className="inline-flex items-center gap-2 rounded border px-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={form.preferred_days.includes(day.label)}
                        onChange={(event) =>
                          setForm((currentForm) => ({
                            ...currentForm,
                            preferred_days: event.target.checked
                              ? [...new Set([...currentForm.preferred_days, day.label])]
                              : currentForm.preferred_days.filter((value) => value !== day.label)
                          }))
                        }
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              )}
              <span className="text-xs text-slate-500">Soft constraint. I giorni finali sono sempre esclusi.</span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Fasce orarie preferite</span>
              <input
                className="rounded-lg border px-3 py-2"
                placeholder="Es: 10:00-13:00, 15:00-18:00"
                value={form.preferred_windows_csv}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, preferred_windows_csv: event.target.value }))}
              />
              <span className="text-xs text-slate-500">Soft constraint.</span>
            </label>

            <div className="space-y-1">
              <span className="text-sm font-medium">
                Slot indisponibili{" "}
                {form.unavailable_slot_ids.length > 0 ? (
                  <span className="rounded bg-red-100 text-red-700 text-xs px-1.5 py-0.5">{form.unavailable_slot_ids.length}</span>
                ) : null}
              </span>
              <p className="text-xs text-slate-500">Hard constraint: la squadra non potra mai essere schedulata in questi slot.</p>
              {slotsQuery.isLoading ? (
                <p className="text-sm text-slate-500">Caricamento slot...</p>
              ) : (
                <SlotPicker
                  slots={slots}
                  selected={form.unavailable_slot_ids}
                  onChange={(ids) => setForm((currentForm) => ({ ...currentForm, unavailable_slot_ids: ids }))}
                />
              )}
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.prefers_consecutive}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, prefers_consecutive: event.target.checked }))}
              />
              <span className="text-sm">Preferisce partite consecutive (soft)</span>
            </label>

            <div className="border-t pt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg bg-slate-900 text-white px-4 py-2 disabled:opacity-50"
                onClick={() => void submitForm()}
                disabled={createMutation.isPending || updateMutation.isPending || !targetTid}
              >
                {editingTeam ? "Salva modifiche" : "Crea squadra"}
              </button>
              <button type="button" className="rounded-lg border px-4 py-2" onClick={closeDrawer}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
