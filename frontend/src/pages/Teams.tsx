import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, teamApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Slot, Team } from "../types";

type TeamFormState = {
  name: string;
  gender: "M" | "F";
  preferred_days_csv: string;
  preferred_windows_csv: string;
  unavailable_slot_ids: string[];
  prefers_consecutive: boolean;
};

const EMPTY_FORM: TeamFormState = {
  name: "",
  gender: "M",
  preferred_days_csv: "",
  preferred_windows_csv: "",
  unavailable_slot_ids: [],
  prefers_consecutive: false
};

function parsePreferredWindows(csv: string) {
  return csv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [start, end] = entry.split("-").map((s) => s.trim());
      return { start, end };
    })
    .filter((w) => w.start && w.end);
}

function serializePreferredWindows(windows: Array<{ start: string; end: string }>) {
  return windows.map((w) => `${w.start}-${w.end}`).join(", ");
}

function teamToForm(team: Team): TeamFormState {
  return {
    name: team.name,
    gender: team.gender,
    preferred_days_csv: (team.preferred_days || []).join(", "),
    preferred_windows_csv: serializePreferredWindows((team.preferred_time_windows || []) as Array<{ start: string; end: string }>),
    unavailable_slot_ids: team.unavailable_slot_ids || [],
    prefers_consecutive: team.prefers_consecutive
  };
}

function formToPayload(form: TeamFormState) {
  return {
    name: form.name.trim(),
    gender: form.gender,
    preferred_days: form.preferred_days_csv
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    preferred_time_windows: parsePreferredWindows(form.preferred_windows_csv),
    unavailable_slot_ids: form.unavailable_slot_ids,
    prefers_consecutive: form.prefers_consecutive
  };
}

// Group slots by day for the slot picker
function groupSlotsByDay(slots: Slot[]): Map<string, Slot[]> {
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
    return (
      <p className="text-sm text-slate-500 italic">
        Nessuno slot disponibile. Aggiungi dei giorni al torneo prima.
      </p>
    );
  }

  const toggleSlot = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const toggleDay = (daySlots: Slot[]) => {
    const dayIds = daySlots.map((s) => s.id);
    const allSelected = dayIds.every((id) => selected.includes(id));
    if (allSelected) {
      onChange(selected.filter((id) => !dayIds.includes(id)));
    } else {
      const next = new Set([...selected, ...dayIds]);
      onChange([...next]);
    }
  };

  return (
    <div className="border rounded divide-y max-h-64 overflow-y-auto text-sm">
      {[...byDay.entries()].map(([dayLabel, daySlots]) => {
        const dayIds = daySlots.map((s) => s.id);
        const allSelected = dayIds.every((id) => selected.includes(id));
        const someSelected = !allSelected && dayIds.some((id) => selected.includes(id));
        return (
          <div key={dayLabel} className="p-2">
            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={() => toggleDay(daySlots)}
              />
              {dayLabel}
            </label>
            <div className="ml-6 mt-1 flex flex-wrap gap-2">
              {daySlots.map((slot) => (
                <label key={slot.id} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(slot.id)}
                    onChange={() => toggleSlot(slot.id)}
                  />
                  <span className="text-slate-700">{slot.start_time}–{slot.end_time}</span>
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
  const [genderFilter, setGenderFilter] = useState<"ALL" | "M" | "F">("ALL");
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });

  const activeTid = current?.id || "";
  const teamsQuery = useQuery({
    queryKey: ["teams", activeTid],
    queryFn: () => teamApi.list(activeTid),
    enabled: Boolean(activeTid)
  });

  const slotsQuery = useQuery({
    queryKey: ["slots", activeTid],
    queryFn: () => tournamentApi.getSlots(activeTid),
    enabled: Boolean(activeTid) && panelOpen
  });

  useEffect(() => {
    if (!current && tournamentsQuery.data?.length) {
      setCurrent(tournamentsQuery.data[0]);
    }
  }, [current, setCurrent, tournamentsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => teamApi.create(activeTid, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", activeTid] })
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => teamApi.update(activeTid, id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", activeTid] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teamApi.delete(activeTid, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", activeTid] })
  });

  const filteredTeams = useMemo(() => {
    const list = (teamsQuery.data || []) as Team[];
    if (genderFilter === "ALL") return list;
    return list.filter((team) => team.gender === genderFilter);
  }, [genderFilter, teamsQuery.data]);

  const openCreate = () => {
    setEditingTeam(null);
    setForm(EMPTY_FORM);
    setErrorMessage(null);
    setPanelOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditingTeam(team);
    setForm(teamToForm(team));
    setErrorMessage(null);
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditingTeam(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async () => {
    if (!activeTid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    if (!form.name.trim()) {
      setErrorMessage("Inserisci il nome squadra.");
      return;
    }

    setErrorMessage(null);
    const payload = formToPayload(form);

    try {
      if (editingTeam) {
        await updateMutation.mutateAsync({ id: editingTeam.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      closePanel();
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore durante il salvataggio.");
    }
  };

  const onDeleteTeam = async (id: string) => {
    if (!confirm("Eliminare questa squadra?")) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore durante l'eliminazione.");
    }
  };

  const onImportCsv = async (file: File | null) => {
    if (!file || !activeTid) return;
    setImporting(true);
    setErrorMessage(null);
    try {
      await teamApi.import(activeTid, file);
      await queryClient.invalidateQueries({ queryKey: ["teams", activeTid] });
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore import CSV.");
    } finally {
      setImporting(false);
    }
  };

  const csvTemplateUrl = `${String(api.defaults.baseURL ?? "http://localhost:8000")}/api/tournaments/${activeTid}/teams/csv-template`;
  const slots = (slotsQuery.data || []) as Slot[];

  const maleCount = ((teamsQuery.data || []) as Team[]).filter((t) => t.gender === "M").length;
  const femaleCount = ((teamsQuery.data || []) as Team[]).filter((t) => t.gender === "F").length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Squadre</h1>
          <p className="text-slate-600">Gestione squadre, preferenze orarie e import CSV.</p>
        </div>
        <button className="px-4 py-2 rounded bg-slate-900 text-white" type="button" onClick={openCreate} disabled={!activeTid}>
          + Nuova squadra
        </button>
      </header>

      {errorMessage ? <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded">{errorMessage}</div> : null}

      <section className="bg-white p-4 rounded shadow space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
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
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm">Filtro genere</span>
            <select
              className="border rounded px-3 py-2"
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value as "ALL" | "M" | "F")}
            >
              <option value="ALL">Tutti ({maleCount + femaleCount})</option>
              <option value="M">Maschile ({maleCount})</option>
              <option value="F">Femminile ({femaleCount})</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm">Import CSV</span>
            <input
              className="border rounded px-3 py-2"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onImportCsv(e.target.files?.[0] || null)}
              disabled={importing || !activeTid}
            />
          </label>

          {activeTid ? (
            <a
              className="px-3 py-2 border rounded text-sm hover:bg-slate-50"
              href={csvTemplateUrl}
              target="_blank"
              rel="noreferrer"
            >
              📥 Template CSV
            </a>
          ) : null}
        </div>
      </section>

      <section className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Gen.</th>
              <th className="text-left px-3 py-2">Giorni preferiti</th>
              <th className="text-left px-3 py-2">Fasce preferite</th>
              <th className="text-left px-3 py-2">Indisponibilità</th>
              <th className="text-left px-3 py-2">Consecutive</th>
              <th className="text-left px-3 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {teamsQuery.isLoading ? (
              <tr>
                <td className="px-3 py-4" colSpan={7}>
                  Caricamento...
                </td>
              </tr>
            ) : filteredTeams.length === 0 ? (
              <tr>
                <td className="px-3 py-4" colSpan={7}>
                  Nessuna squadra disponibile.
                </td>
              </tr>
            ) : (
              filteredTeams.map((team) => (
                <tr key={team.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{team.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded ${
                        team.gender === "M" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"
                      }`}
                    >
                      {team.gender}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{(team.preferred_days || []).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {(team.preferred_time_windows || [])
                      .map((w) => `${w.start}–${w.end}`)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {(team.unavailable_slot_ids || []).length > 0
                      ? `${(team.unavailable_slot_ids || []).length} slot`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{team.prefers_consecutive ? "✓" : "—"}</td>
                  <td className="px-3 py-2 flex gap-2">
                    <button className="px-2 py-1 border rounded hover:bg-slate-50" type="button" onClick={() => openEdit(team)}>
                      Modifica
                    </button>
                    <button
                      className="px-2 py-1 border rounded text-red-700 hover:bg-red-50"
                      type="button"
                      onClick={() => void onDeleteTeam(team.id)}
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {panelOpen ? (
        <div className="fixed inset-0 z-50 bg-black/30 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full p-5 overflow-y-auto space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">{editingTeam ? "Modifica squadra" : "Nuova squadra"}</h2>
              <button className="border px-3 py-1 rounded hover:bg-slate-50" type="button" onClick={closePanel}>
                ✕ Chiudi
              </button>
            </div>

            {errorMessage ? (
              <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded text-sm">{errorMessage}</div>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Nome squadra *</span>
              <input
                className="border rounded px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Es. Team Alfa"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Genere</span>
              <select
                className="border rounded px-3 py-2"
                value={form.gender}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "M" | "F" }))}
              >
                <option value="M">Maschile (M)</option>
                <option value="F">Femminile (F)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Giorni preferiti</span>
              <input
                className="border rounded px-3 py-2"
                placeholder="Es: Giorno 1, Giorno 2"
                value={form.preferred_days_csv}
                onChange={(e) => setForm((f) => ({ ...f, preferred_days_csv: e.target.value }))}
              />
              <span className="text-xs text-slate-500">Etichette separate da virgola. Soft constraint (penalità configurabile).</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Fasce orarie preferite</span>
              <input
                className="border rounded px-3 py-2"
                placeholder="Es: 10:00-13:00, 15:00-18:00"
                value={form.preferred_windows_csv}
                onChange={(e) => setForm((f) => ({ ...f, preferred_windows_csv: e.target.value }))}
              />
              <span className="text-xs text-slate-500">Fasce HH:MM-HH:MM separate da virgola. Soft constraint.</span>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                Slot indisponibili
                {form.unavailable_slot_ids.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                    {form.unavailable_slot_ids.length} selezionati
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500 mb-1">Hard constraint: il solver non assegnerà mai la squadra in questi slot.</span>
              {slotsQuery.isLoading ? (
                <p className="text-sm text-slate-400">Caricamento slot...</p>
              ) : (
                <SlotPicker
                  slots={slots}
                  selected={form.unavailable_slot_ids}
                  onChange={(ids) => setForm((f) => ({ ...f, unavailable_slot_ids: ids }))}
                />
              )}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.prefers_consecutive}
                onChange={(e) => setForm((f) => ({ ...f, prefers_consecutive: e.target.checked }))}
              />
              <span className="text-sm">Preferisce partite in slot consecutivi (soft constraint)</span>
            </label>

            <div className="flex gap-2 pt-2 border-t">
              <button
                className="flex-1 px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                type="button"
                onClick={() => void submitForm()}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {editingTeam ? "Salva modifiche" : "Crea squadra"}
              </button>
              <button className="px-4 py-2 border rounded hover:bg-slate-50" type="button" onClick={closePanel}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
