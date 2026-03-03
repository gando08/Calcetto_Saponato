import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";
import type { Match } from "../types";

type ExportScope = "all" | "male" | "female" | "team" | "day";

function extractFilename(contentDisposition: string | undefined, fallback: string) {
  if (!contentDisposition) return fallback;
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const basic = contentDisposition.match(/filename="?([^"]+)"?/i)?.[1];
  if (basic) return basic;
  return fallback;
}

function downloadBlobFile(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function Export() {
  const { current, setCurrent } = useTournamentStore();
  const [scope, setScope] = useState<ExportScope>("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedDayId, setSelectedDayId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const tournamentsQuery = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => tournamentApi.list()
  });

  useEffect(() => {
    if (!current && tournamentsQuery.data?.length) {
      setCurrent(tournamentsQuery.data[0]);
    }
  }, [current, setCurrent, tournamentsQuery.data]);

  const tid = current?.id || "";

  const scheduleQuery = useQuery({
    queryKey: ["schedule", tid],
    queryFn: () => tournamentApi.getSchedule(tid),
    enabled: Boolean(tid)
  });

  const matches = (scheduleQuery.data || []) as Match[];

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of matches) {
      if (match.team_home_id) map.set(match.team_home_id, match.team_home);
      if (match.team_away_id) map.set(match.team_away_id, match.team_away);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
  }, [matches]);

  const dayOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of matches) {
      if (match.slot?.day_id) {
        map.set(match.slot.day_id, match.slot.day_label);
      }
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "it"));
  }, [matches]);

  useEffect(() => {
    if (!selectedTeamId && teamOptions.length > 0) {
      setSelectedTeamId(teamOptions[0].id);
    }
    if (selectedTeamId && !teamOptions.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teamOptions[0]?.id || "");
    }
  }, [selectedTeamId, teamOptions]);

  useEffect(() => {
    if (!selectedDayId && dayOptions.length > 0) {
      setSelectedDayId(dayOptions[0].id);
    }
    if (selectedDayId && !dayOptions.some((day) => day.id === selectedDayId)) {
      setSelectedDayId(dayOptions[0]?.id || "");
    }
  }, [dayOptions, selectedDayId]);

  const exportCsvMutation = useMutation({
    mutationFn: (params?: { gender?: "M" | "F"; team_id?: string; day_id?: string }) => tournamentApi.exportCsv(tid, params)
  });

  const exportPdfMutation = useMutation({
    mutationFn: (params?: { gender?: "M" | "F"; team_id?: string; day_id?: string }) => tournamentApi.exportPdf(tid, params)
  });

  const isPending = exportCsvMutation.isPending || exportPdfMutation.isPending;

  const exportParams = useMemo(() => {
    if (scope === "male") return { gender: "M" as const };
    if (scope === "female") return { gender: "F" as const };
    if (scope === "team" && selectedTeamId) return { team_id: selectedTeamId };
    if (scope === "day" && selectedDayId) return { day_id: selectedDayId };
    return undefined;
  }, [scope, selectedDayId, selectedTeamId]);

  const onExportCsv = async () => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await exportCsvMutation.mutateAsync(exportParams);
      const fallback = `calendario_${tid}.csv`;
      const filename = extractFilename(response.headers?.["content-disposition"] as string | undefined, fallback);
      downloadBlobFile(response.data as Blob, filename);
      setSuccessMessage(`Export CSV completato: ${filename}`);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante export CSV.");
    }
  };

  const onExportPdf = async () => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await exportPdfMutation.mutateAsync(exportParams);
      const fallback = `torneo_${tid}.pdf`;
      const filename = extractFilename(response.headers?.["content-disposition"] as string | undefined, fallback);
      downloadBlobFile(response.data as Blob, filename);
      setSuccessMessage(`Export PDF completato: ${filename}`);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Errore durante export PDF.");
    }
  };

  const printScope = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Export</h1>
        <p className="text-sm text-slate-600">Esporta calendario in CSV/PDF o stampa con scope per torneo, genere, squadra o giorno.</p>
      </header>

      {errorMessage ? <div className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-red-700 text-sm">{errorMessage}</div> : null}
      {successMessage ? <div className="rounded-lg border border-green-300 bg-green-100 px-3 py-2 text-green-700 text-sm">{successMessage}</div> : null}

      <section className="rounded-xl border bg-white p-4 shadow-sm space-y-4">
        <label className="flex flex-col gap-1 max-w-md">
          <span className="text-xs uppercase tracking-wide text-slate-500">Torneo attivo</span>
          <select
            className="rounded-lg border px-3 py-2"
            value={current?.id || ""}
            onChange={(event) => {
              const selected = (tournamentsQuery.data || []).find((t: { id: string }) => t.id === event.target.value);
              if (selected) setCurrent(selected);
            }}
          >
            {(tournamentsQuery.data || []).map((tournament: { id: string; name: string }) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left ${scope === "all" ? "bg-slate-900 text-white border-slate-900" : ""}`}
            onClick={() => setScope("all")}
          >
            Tutto il torneo (M + F)
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left ${scope === "male" ? "bg-slate-900 text-white border-slate-900" : ""}`}
            onClick={() => setScope("male")}
          >
            Solo Maschile
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left ${scope === "female" ? "bg-slate-900 text-white border-slate-900" : ""}`}
            onClick={() => setScope("female")}
          >
            Solo Femminile
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left ${scope === "team" ? "bg-slate-900 text-white border-slate-900" : ""}`}
            onClick={() => setScope("team")}
          >
            Per squadra
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-2 text-left ${scope === "day" ? "bg-slate-900 text-white border-slate-900" : ""}`}
            onClick={() => setScope("day")}
          >
            Per giorno
          </button>
        </div>

        {scope === "team" ? (
          <label className="flex flex-col gap-1 max-w-md">
            <span className="text-xs uppercase tracking-wide text-slate-500">Squadra</span>
            <select
              className="rounded-lg border px-3 py-2"
              value={selectedTeamId}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              disabled={teamOptions.length === 0}
            >
              {teamOptions.length === 0 ? (
                <option value="">Nessuna squadra disponibile</option>
              ) : (
                teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}

        {scope === "day" ? (
          <label className="flex flex-col gap-1 max-w-md">
            <span className="text-xs uppercase tracking-wide text-slate-500">Giorno</span>
            <select
              className="rounded-lg border px-3 py-2"
              value={selectedDayId}
              onChange={(event) => setSelectedDayId(event.target.value)}
              disabled={dayOptions.length === 0}
            >
              {dayOptions.length === 0 ? (
                <option value="">Nessun giorno disponibile</option>
              ) : (
                dayOptions.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.label}
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border px-4 py-2 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            onClick={() => void onExportCsv()}
            disabled={!tid || isPending || (scope === "team" && !selectedTeamId) || (scope === "day" && !selectedDayId)}
          >
            {exportCsvMutation.isPending ? "Esportazione..." : "📄 CSV"}
          </button>
          <button
            type="button"
            className="rounded-lg border px-4 py-2 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
            onClick={() => void onExportPdf()}
            disabled={!tid || isPending || (scope === "team" && !selectedTeamId) || (scope === "day" && !selectedDayId)}
          >
            {exportPdfMutation.isPending ? "Generazione..." : "📑 PDF"}
          </button>
          <button type="button" className="rounded-lg border px-4 py-2 bg-slate-50 hover:bg-slate-100" onClick={printScope} disabled={isPending}>
            🖨 Stampa
          </button>
        </div>
      </section>
    </div>
  );
}
