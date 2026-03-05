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
      if (quoted && next === "\"") { value += "\""; i += 1; } else { quoted = !quoted; }
      continue;
    }
    if (char === "," && !quoted) { cells.push(value.trim()); value = ""; continue; }
    value += char;
  }
  cells.push(value.trim());
  return cells;
}

function parsePreferredWindows(csv: string) {
  return csv.split(",").map((e) => e.trim()).filter(Boolean)
    .map((e) => { const [start, end] = e.split("-").map((v) => v.trim()); return { start, end }; })
    .filter((w) => w.start && w.end);
}

function serializePreferredWindows(windows: Array<{ start: string; end: string }>) {
  return windows.map((w) => `${w.start}-${w.end}`).join(", ");
}

function normalizeToken(value: string) { return (value || "").trim().toLowerCase(); }

function mapPreferredDaysToLabels(preferredDays: string[], days: TournamentDay[]) {
  if (!preferredDays?.length || !days?.length) return preferredDays || [];
  return [...new Set(preferredDays.map((token) => {
    const normalized = normalizeToken(token);
    const matched = days.find((day) =>
      normalizeToken(day.id) === normalized || normalizeToken(day.label) === normalized || normalizeToken(day.date) === normalized
    );
    return matched ? matched.label : token;
  }))];
}

function teamToForm(team: Team, days: TournamentDay[]): TeamFormState {
  return {
    name: team.name,
    gender: team.gender,
    preferred_days: mapPreferredDaysToLabels(team.preferred_days || [], days),
    preferred_windows_csv: serializePreferredWindows((team.preferred_time_windows || []) as Array<{ start: string; end: string }>),
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

function SlotPicker({ slots, selected, onChange }: { slots: Slot[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const byDay = useMemo(() => groupSlotsByDay(slots), [slots]);
  if (slots.length === 0) return <p className="text-sm italic" style={{ color: "rgba(255,255,255,0.35)" }}>Nessuno slot disponibile. Configura prima i giorni del torneo.</p>;

  const toggleSlot = (id: string) => onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);
  const toggleDay = (daySlots: Slot[]) => {
    const dayIds = daySlots.map((s) => s.id);
    const allSelected = dayIds.every((id) => selected.includes(id));
    if (allSelected) { onChange(selected.filter((id) => !dayIds.includes(id))); return; }
    onChange([...new Set([...selected, ...dayIds])]);
  };

  return (
    <div className="rounded-xl overflow-hidden max-h-60 overflow-y-auto" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
      {[...byDay.entries()].map(([dayLabel, daySlots]) => {
        const dayIds = daySlots.map((s) => s.id);
        const allSelected = dayIds.every((id) => selected.includes(id));
        const someSelected = !allSelected && dayIds.some((id) => selected.includes(id));
        return (
          <div key={dayLabel} className="p-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer mb-2" style={{ color: "rgba(255,255,255,0.75)" }}>
              <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }} onChange={() => toggleDay(daySlots)} className="accent-emerald-400" />
              {dayLabel}
            </label>
            <div className="ml-5 flex flex-wrap gap-2">
              {daySlots.map((slot) => (
                <label key={slot.id} className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <input type="checkbox" checked={selected.includes(slot.id)} onChange={() => toggleSlot(slot.id)} className="accent-emerald-400" />
                  {slot.start_time}-{slot.end_time}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeamCard({ team, tournamentsById, onEdit, onDelete }: { team: Team; tournamentsById: Map<string, Tournament>; onEdit: (t: Team) => void; onDelete: (t: Team) => void }) {
  const isMale = team.gender === "M";
  const genderColor = isMale ? "#60a5fa" : "#f472b6";
  const genderBg = isMale ? "rgba(59,130,246,0.12)" : "rgba(236,72,153,0.12)";
  const initials = team.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="sport-card-interactive p-4 flex flex-col gap-3" onClick={() => onEdit(team)}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{
              background: genderBg,
              color: genderColor,
              border: `1px solid ${genderColor}30`,
              fontFamily: "Rajdhani, sans-serif",
            }}
          >
            {initials}
          </div>
          <div>
            <div className="font-semibold text-sm">{team.name}</div>
            <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              {tournamentsById.get(team.tournament_id)?.name || "Torneo sconosciuto"}
            </div>
          </div>
        </div>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: genderBg, color: genderColor }}
        >
          {team.gender}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "rgba(255,255,255,0.35)" }}>Giorni pref.</div>
          <div className="font-medium mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.7)" }}>
            {(team.preferred_days || []).join(", ") || "Nessuno"}
          </div>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "rgba(255,255,255,0.35)" }}>Indisponibilità</div>
          <div className="font-medium mt-0.5" style={{ color: (team.unavailable_slot_ids || []).length > 0 ? "#fb923c" : "rgba(255,255,255,0.7)" }}>
            {(team.unavailable_slot_ids || []).length > 0 ? `${team.unavailable_slot_ids.length} slot` : "Nessuna"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
          {team.prefers_consecutive ? "✓ Consecutive" : "Qualsiasi slot"}
        </span>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="sport-btn-secondary text-xs py-1 px-3"
            onClick={() => onEdit(team)}
          >
            Modifica
          </button>
          <button
            type="button"
            className="sport-btn-danger text-xs py-1 px-3"
            onClick={() => void onDelete(team)}
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  );
}

export function Teams() {
  const queryClient = useQueryClient();
  const { current, setCurrent } = useTournamentStore();
  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [importGender, setImportGender] = useState<"M" | "F">("M");
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const tournamentsQuery = useQuery({ queryKey: ["tournaments"], queryFn: () => tournamentApi.list() });
  const tournaments = (tournamentsQuery.data || []) as Tournament[];
  const pairs = useMemo(() => buildTournamentPairs(tournaments), [tournaments]);
  const selectedPair = useMemo(() => pairs.find((p) => p.key === selectedPairKey) ?? null, [pairs, selectedPairKey]);

  useEffect(() => {
    if (!pairs.length) { if (selectedPairKey) setSelectedPairKey(""); return; }
    if (selectedPairKey && pairs.some((p) => p.key === selectedPairKey)) return;
    const pairFromCurrent = current ? pairs.find((p) => p.male?.id === current.id || p.female?.id === current.id) : null;
    setSelectedPairKey((pairFromCurrent || pairs[0]).key);
  }, [current?.id, pairs, selectedPairKey]);

  useEffect(() => {
    if (!selectedPair) return;
    const fallback = selectedPair.male || selectedPair.female;
    if (fallback && current?.id !== fallback.id) setCurrent(fallback);
  }, [current?.id, selectedPair, setCurrent]);

  useEffect(() => {
    if (!selectedPair) return;
    if (importGender === "M" && !selectedPair.male && selectedPair.female) setImportGender("F");
    if (importGender === "F" && !selectedPair.female && selectedPair.male) setImportGender("M");
  }, [importGender, selectedPair]);

  const maleTid = selectedPair?.male?.id || "";
  const femaleTid = selectedPair?.female?.id || "";
  const importTid = importGender === "M" ? maleTid : femaleTid;

  const teamsMaleQuery = useQuery({ queryKey: ["teams", maleTid], queryFn: () => teamApi.list(maleTid), enabled: Boolean(maleTid) });
  const teamsFemaleQuery = useQuery({ queryKey: ["teams", femaleTid], queryFn: () => teamApi.list(femaleTid), enabled: Boolean(femaleTid) });

  const targetTid = useMemo(() => {
    if (editingTeam?.tournament_id) return editingTeam.tournament_id;
    return getTournamentIdForGender(selectedPair, form.gender) || "";
  }, [editingTeam?.tournament_id, form.gender, selectedPair]);

  const slotsQuery = useQuery({ queryKey: ["slots", targetTid], queryFn: () => tournamentApi.getSlots(targetTid), enabled: Boolean(targetTid) && drawerOpen });
  const daysQuery = useQuery({ queryKey: ["days", targetTid], queryFn: () => tournamentApi.getDays(targetTid), enabled: Boolean(targetTid) && drawerOpen });

  const createMutation = useMutation({ mutationFn: ({ tid, payload }: { tid: string; payload: unknown }) => teamApi.create(tid, payload), onSuccess: (_, v) => queryClient.invalidateQueries({ queryKey: ["teams", v.tid] }) });
  const updateMutation = useMutation({ mutationFn: ({ tid, id, payload }: { tid: string; id: string; payload: unknown }) => teamApi.update(tid, id, payload), onSuccess: (_, v) => queryClient.invalidateQueries({ queryKey: ["teams", v.tid] }) });
  const deleteMutation = useMutation({ mutationFn: ({ tid, id }: { tid: string; id: string }) => teamApi.delete(tid, id), onSuccess: (_, v) => queryClient.invalidateQueries({ queryKey: ["teams", v.tid] }) });
  const importMutation = useMutation({ mutationFn: ({ tid, file }: { tid: string; file: File }) => teamApi.import(tid, file), onSuccess: async (_, v) => { await queryClient.invalidateQueries({ queryKey: ["teams", v.tid] }); } });

  const teams = useMemo(() => {
    const all = [...((teamsMaleQuery.data || []) as Team[]), ...((teamsFemaleQuery.data || []) as Team[])];
    return all.sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [teamsFemaleQuery.data, teamsMaleQuery.data]);

  const slots = (slotsQuery.data || []) as Slot[];
  const days = (daysQuery.data || []) as TournamentDay[];
  const nonFinalDays = days.filter((d) => !d.is_finals_day);
  const teamsLoading = (maleTid ? teamsMaleQuery.isLoading : false) || (femaleTid ? teamsFemaleQuery.isLoading : false);
  const maleCount = teams.filter((t) => t.gender === "M").length;
  const femaleCount = teams.filter((t) => t.gender === "F").length;
  const csvTemplateUrl = importTid ? `${String(api.defaults.baseURL ?? "http://localhost:8000")}/api/tournaments/${importTid}/teams/csv-template` : "";
  const tournamentsById = useMemo(() => new Map(tournaments.map((t) => [t.id, t])), [tournaments]);

  const openCreate = () => { setEditingTeam(null); setForm({ ...EMPTY_FORM, gender: maleTid ? "M" : "F" }); setErrorMessage(null); setDrawerOpen(true); };
  const openEdit = (team: Team) => { setEditingTeam(team); setForm(teamToForm(team, [])); setErrorMessage(null); setDrawerOpen(true); };

  useEffect(() => {
    if (!drawerOpen || !days.length) return;
    setForm((f) => ({ ...f, preferred_days: mapPreferredDaysToLabels(f.preferred_days, days) }));
  }, [days, drawerOpen]);

  const closeDrawer = () => { setDrawerOpen(false); setEditingTeam(null); setForm(EMPTY_FORM); };

  const submitForm = async () => {
    if (!form.name.trim()) { setErrorMessage("Inserisci il nome squadra."); return; }
    if (!targetTid) { setErrorMessage(form.gender === "M" ? "Manca il torneo maschile." : "Manca il torneo femminile."); return; }
    setErrorMessage(null);
    const payload = formToPayload(form);
    try {
      if (editingTeam) { await updateMutation.mutateAsync({ tid: targetTid, id: editingTeam.id, payload }); }
      else { await createMutation.mutateAsync({ tid: targetTid, payload }); }
      closeDrawer();
    } catch (error: unknown) { setErrorMessage(error instanceof Error ? error.message : "Errore durante il salvataggio."); }
  };

  const onDeleteTeam = async (team: Team) => {
    if (!confirm("Eliminare questa squadra?")) return;
    setErrorMessage(null);
    try { await deleteMutation.mutateAsync({ tid: team.tournament_id, id: team.id }); }
    catch (error: unknown) { setErrorMessage(error instanceof Error ? error.message : "Errore durante eliminazione squadra."); }
  };

  const clearImportState = () => { setCsvFile(null); setCsvPreview(null); setCsvLoading(false); };

  const onSelectCsv = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setErrorMessage("Seleziona un file .csv."); return; }
    setCsvFile(file); setCsvLoading(true); setErrorMessage(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) { setCsvPreview({ headers: [], rows: [] }); return; }
      const headers = splitCsvLine(lines[0]);
      const rows = lines.slice(1).map((l) => splitCsvLine(l));
      setCsvPreview({ headers, rows });
    } catch (error: unknown) { setErrorMessage(error instanceof Error ? error.message : "Errore lettura file CSV."); clearImportState(); }
    finally { setCsvLoading(false); }
  };

  const confirmImportCsv = async () => {
    if (!csvFile) { setErrorMessage("Seleziona un file CSV da importare."); return; }
    if (!importTid) { setErrorMessage(importGender === "M" ? "Manca il torneo maschile." : "Manca il torneo femminile."); return; }
    setErrorMessage(null);
    try { await importMutation.mutateAsync({ tid: importTid, file: csvFile }); clearImportState(); }
    catch (error: unknown) { setErrorMessage(error instanceof Error ? error.message : "Errore import CSV."); }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* Header */}
      <header>
        <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00e676" }}>Gestione</div>
        <h1 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800 }}>
          Squadre
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
          Aggiungi le squadre maschili e femminili — vengono assegnate automaticamente alla sezione corretta.
        </p>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

      {/* Controls */}
      <div className="sport-card p-5 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Edizione</span>
            <select
              className="sport-select min-w-52"
              value={selectedPairKey}
              onChange={(e) => { setSelectedPairKey(e.target.value); setErrorMessage(null); }}
            >
              {pairs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>

          <button className="sport-btn-primary" type="button" onClick={openCreate} disabled={!selectedPair}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Aggiungi squadra
          </button>

          <button
            className="sport-btn-secondary"
            type="button"
            onClick={() => setShowImport(!showImport)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Import CSV
          </button>

          {csvTemplateUrl && (
            <a className="sport-btn-secondary" href={csvTemplateUrl} target="_blank" rel="noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Template CSV
            </a>
          )}
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.07)" }}>
            Totale squadre
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[22px] text-center" style={{ background: "rgba(255,255,255,0.08)" }}>
              {maleCount + femaleCount}
            </span>
          </div>

          {selectedPair && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {([
                { gender: "M", t: selectedPair.male, count: maleCount, color: "#60a5fa", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.25)", label: "Maschile" },
                { gender: "F", t: selectedPair.female, count: femaleCount, color: "#f472b6", bg: "rgba(236,72,153,0.12)", border: "rgba(236,72,153,0.25)", label: "Femminile" },
              ] as const).map(({ gender, t, count, color, bg, border, label }) => {
                const max = t?.max_teams;
                const configured = Boolean(t);
                return (
                  <div key={gender} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: configured ? bg : "rgba(255,255,255,0.04)", border: `1px solid ${configured ? border : "rgba(255,255,255,0.08)"}`, color: configured ? color : "rgba(255,255,255,0.3)" }}>
                    <span>{gender === "M" ? "♂" : "♀"} {label}</span>
                    <span className="font-bold px-1.5 py-0.5 rounded-full" style={{ background: configured ? `${color}25` : "rgba(255,255,255,0.07)", minWidth: 28, textAlign: "center" }}>
                      {configured ? (max ? `${count}/${max}` : String(count)) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Import panel */}
        {showImport && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Import target</span>
                <select className="sport-select" value={importGender} onChange={(e) => setImportGender(e.target.value as "M" | "F")}>
                  <option value="M">Maschile (M)</option>
                  <option value="F">Femminile (F)</option>
                </select>
              </div>
            </div>
            <div
              className={`rounded-xl border-2 border-dashed p-6 text-sm text-center transition-colors cursor-pointer ${dragActive ? "border-emerald-400" : ""}`}
              style={{ borderColor: dragActive ? "#00e676" : "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); void onSelectCsv(e.dataTransfer.files?.[0] || null); }}
            >
              <div className="mb-2 text-2xl">📄</div>
              Trascina un file CSV o{" "}
              <label className="cursor-pointer font-semibold underline" style={{ color: "#00e676" }}>
                sfoglia
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onSelectCsv(e.target.files?.[0] || null)} disabled={!importTid || importMutation.isPending} />
              </label>
            </div>

            {(csvFile || csvPreview) && (
              <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-semibold">{csvFile?.name ?? "—"}</div>
                    {csvPreview && <div style={{ color: "rgba(255,255,255,0.4)" }}>{csvPreview.rows.length} righe</div>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="sport-btn-secondary text-xs" onClick={clearImportState} disabled={importMutation.isPending || csvLoading}>Annulla</button>
                    <button type="button" className="sport-btn-primary text-xs" onClick={() => void confirmImportCsv()} disabled={!csvFile || importMutation.isPending || csvLoading}>
                      {importMutation.isPending ? "Import..." : "Conferma import"}
                    </button>
                  </div>
                </div>
                {!csvLoading && csvPreview?.headers.length ? (
                  <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <table className="min-w-full text-xs">
                      <thead><tr>{csvPreview.headers.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold" style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.04)" }}>{h}</th>)}</tr></thead>
                      <tbody>{csvPreview.rows.slice(0, 8).map((row, ri) => <tr key={ri} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>{row.map((cell, ci) => <td key={ci} className="px-2 py-1" style={{ color: "rgba(255,255,255,0.6)" }}>{cell || "—"}</td>)}</tr>)}</tbody>
                    </table>
                    {csvPreview.rows.length > 8 && <div className="px-2 py-1 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Anteprima limitata a 8 righe.</div>}
                  </div>
                ) : csvLoading ? <div className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Lettura file...</div> : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Teams grid */}
      {teamsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="sport-skeleton h-36" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="sport-card p-8 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
          <div className="text-3xl mb-3">👥</div>
          <div className="font-semibold">Nessuna squadra disponibile</div>
          <div className="text-sm mt-1">Aggiungi squadre con il pulsante in alto.</div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              tournamentsById={tournamentsById}
              onEdit={openEdit}
              onDelete={onDeleteTeam}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}>
          <div
            className="w-full max-w-lg h-full overflow-y-auto flex flex-col"
            style={{ background: "#0d1224", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <h2 style={{ fontFamily: "Rajdhani, sans-serif", fontSize: "22px", fontWeight: 700 }}>
                {editingTeam ? "Modifica Squadra" : "Nuova Squadra"}
              </h2>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}
                onClick={closeDrawer}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 p-6 space-y-5">
              {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Nome squadra *</label>
                <input className="sport-input" value={form.name} placeholder="Es. Team Alpha" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Genere</label>
                <select className="sport-select" value={form.gender} disabled={Boolean(editingTeam)} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "M" | "F" }))}>
                  <option value="M">Maschile (M)</option>
                  <option value="F">Femminile (F)</option>
                </select>
                {editingTeam && <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Il genere non è modificabile in modifica.</span>}
                {!targetTid && <span className="text-xs" style={{ color: "#fb923c" }}>Nessun torneo disponibile per il genere {form.gender}.</span>}
                {targetTid && <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Torneo: {tournamentsById.get(targetTid)?.name || targetTid}</span>}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Giorni preferiti</label>
                {daysQuery.isLoading ? (
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Caricamento giorni...</p>
                ) : nonFinalDays.length === 0 ? (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Nessun giorno non-finale disponibile.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {nonFinalDays.map((day) => {
                      const checked = form.preferred_days.includes(day.label);
                      return (
                        <label
                          key={day.id}
                          className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-xl transition-all duration-200"
                          style={checked ? { background: "rgba(0,230,118,0.12)", border: "1px solid rgba(0,230,118,0.3)", color: "#00e676" } : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
                        >
                          <input type="checkbox" className="hidden" checked={checked} onChange={(e) => setForm((f) => ({ ...f, preferred_days: e.target.checked ? [...new Set([...f.preferred_days, day.label])] : f.preferred_days.filter((v) => v !== day.label) }))} />
                          {day.label}
                        </label>
                      );
                    })}
                  </div>
                )}
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Soft constraint. I giorni finali sono esclusi.</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Fasce orarie preferite</label>
                <input className="sport-input" placeholder="Es: 10:00-13:00, 15:00-18:00" value={form.preferred_windows_csv} onChange={(e) => setForm((f) => ({ ...f, preferred_windows_csv: e.target.value }))} />
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Soft constraint. Formato: HH:MM-HH:MM separati da virgola.</span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Slot indisponibili</label>
                  {form.unavailable_slot_ids.length > 0 && (
                    <span className="sport-badge-orange text-xs">{form.unavailable_slot_ids.length} slot</span>
                  )}
                </div>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Hard constraint: la squadra non potrà mai essere schedulata in questi slot.</p>
                {slotsQuery.isLoading ? (
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Caricamento slot...</p>
                ) : (
                  <SlotPicker slots={slots} selected={form.unavailable_slot_ids} onChange={(ids) => setForm((f) => ({ ...f, unavailable_slot_ids: ids }))} />
                )}
              </div>

              <label
                className="flex items-center gap-3 cursor-pointer p-3 rounded-xl transition-all duration-200"
                style={{ background: form.prefers_consecutive ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${form.prefers_consecutive ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.07)"}` }}
              >
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-200"
                  style={{ background: form.prefers_consecutive ? "#00e676" : "rgba(255,255,255,0.1)", border: form.prefers_consecutive ? "none" : "1px solid rgba(255,255,255,0.2)" }}
                >
                  {form.prefers_consecutive && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#080c18" strokeWidth={3}><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <input type="checkbox" className="hidden" checked={form.prefers_consecutive} onChange={(e) => setForm((f) => ({ ...f, prefers_consecutive: e.target.checked }))} />
                <div>
                  <div className="text-sm font-semibold" style={{ color: form.prefers_consecutive ? "#00e676" : "rgba(255,255,255,0.7)" }}>Preferisce partite consecutive</div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Soft constraint</div>
                </div>
              </label>
            </div>

            {/* Drawer footer */}
            <div className="px-6 py-5 flex gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button
                type="button"
                className="sport-btn-primary flex-1"
                onClick={() => void submitForm()}
                disabled={createMutation.isPending || updateMutation.isPending || !targetTid}
              >
                {editingTeam ? "Salva modifiche" : "Crea squadra"}
              </button>
              <button type="button" className="sport-btn-secondary px-4" onClick={closeDrawer}>Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
