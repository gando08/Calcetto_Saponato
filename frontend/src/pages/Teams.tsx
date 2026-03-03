import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { teamApi, tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Team } from "../types";

type TeamFormState = {
  name: string;
  gender: "M" | "F";
  preferred_days_csv: string;
  preferred_windows_csv: string;
  unavailable_slot_ids_csv: string;
  prefers_consecutive: boolean;
};

const EMPTY_FORM: TeamFormState = {
  name: "",
  gender: "M",
  preferred_days_csv: "",
  preferred_windows_csv: "",
  unavailable_slot_ids_csv: "",
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
    unavailable_slot_ids_csv: (team.unavailable_slot_ids || []).join(", "),
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
    unavailable_slot_ids: form.unavailable_slot_ids_csv
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    prefers_consecutive: form.prefers_consecutive
  };
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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Squadre</h1>
          <p className="text-slate-600">Gestione squadre, preferenze e import CSV.</p>
        </div>
        <button className="px-4 py-2 rounded bg-slate-900 text-white" type="button" onClick={openCreate}>
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
              <option value="ALL">Tutti</option>
              <option value="M">Maschile</option>
              <option value="F">Femminile</option>
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
              className="px-3 py-2 border rounded text-sm"
              href={`http://localhost:8000/api/tournaments/${activeTid}/teams/csv-template`}
              target="_blank"
              rel="noreferrer"
            >
              Scarica template CSV
            </a>
          ) : null}
        </div>
      </section>

      <section className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Genere</th>
              <th className="text-left px-3 py-2">Giorni preferiti</th>
              <th className="text-left px-3 py-2">Fasce preferite</th>
              <th className="text-left px-3 py-2">Consecutive</th>
              <th className="text-left px-3 py-2">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {teamsQuery.isLoading ? (
              <tr>
                <td className="px-3 py-4" colSpan={6}>
                  Caricamento...
                </td>
              </tr>
            ) : filteredTeams.length === 0 ? (
              <tr>
                <td className="px-3 py-4" colSpan={6}>
                  Nessuna squadra disponibile.
                </td>
              </tr>
            ) : (
              filteredTeams.map((team) => (
                <tr key={team.id} className="border-t">
                  <td className="px-3 py-2">{team.name}</td>
                  <td className="px-3 py-2">{team.gender}</td>
                  <td className="px-3 py-2">{(team.preferred_days || []).join(", ") || "-"}</td>
                  <td className="px-3 py-2">
                    {(team.preferred_time_windows || [])
                      .map((w) => `${w.start}-${w.end}`)
                      .join(", ") || "-"}
                  </td>
                  <td className="px-3 py-2">{team.prefers_consecutive ? "Sì" : "No"}</td>
                  <td className="px-3 py-2 flex gap-2">
                    <button className="px-2 py-1 border rounded" type="button" onClick={() => openEdit(team)}>
                      Modifica
                    </button>
                    <button className="px-2 py-1 border rounded text-red-700" type="button" onClick={() => void onDeleteTeam(team.id)}>
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
          <div className="w-full max-w-xl bg-white h-full p-5 overflow-y-auto space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">{editingTeam ? "Modifica squadra" : "Nuova squadra"}</h2>
              <button className="border px-3 py-1 rounded" type="button" onClick={closePanel}>
                Chiudi
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Nome</span>
              <input
                className="border rounded px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Genere</span>
              <select
                className="border rounded px-3 py-2"
                value={form.gender}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "M" | "F" }))}
              >
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Giorni preferiti (CSV)</span>
              <input
                className="border rounded px-3 py-2"
                placeholder="giorno1,giorno2"
                value={form.preferred_days_csv}
                onChange={(e) => setForm((f) => ({ ...f, preferred_days_csv: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Fasce preferite (CSV, es: 10:00-13:00,15:00-18:00)</span>
              <input
                className="border rounded px-3 py-2"
                value={form.preferred_windows_csv}
                onChange={(e) => setForm((f) => ({ ...f, preferred_windows_csv: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Slot indisponibili (ID CSV)</span>
              <input
                className="border rounded px-3 py-2"
                value={form.unavailable_slot_ids_csv}
                onChange={(e) => setForm((f) => ({ ...f, unavailable_slot_ids_csv: e.target.value }))}
              />
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.prefers_consecutive}
                onChange={(e) => setForm((f) => ({ ...f, prefers_consecutive: e.target.checked }))}
              />
              <span className="text-sm">Preferisce partite consecutive</span>
            </label>

            <button className="px-4 py-2 bg-slate-900 text-white rounded" type="button" onClick={() => void submitForm()}>
              {editingTeam ? "Salva modifiche" : "Crea squadra"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
