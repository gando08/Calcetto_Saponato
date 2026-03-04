import { type ReactNode, useEffect, useMemo, useState } from "react";

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

const SCOPE_OPTIONS: { value: ExportScope; label: string; description: string; icon: ReactNode }[] = [
  {
    value: "all",
    label: "Tutto il torneo",
    description: "Maschile + Femminile",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M3 12h18M3 6h18M3 18h18" />
      </svg>
    )
  },
  {
    value: "male",
    label: "Solo Maschile",
    description: "Partite M",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="10" cy="14" r="5" />
        <path d="M19 5l-5 5M19 5h-4M19 5v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    value: "female",
    label: "Solo Femminile",
    description: "Partite F",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="10" r="5" />
        <path d="M12 15v5M10 18h4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    value: "team",
    label: "Per squadra",
    description: "Filtra per team",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  },
  {
    value: "day",
    label: "Per giorno",
    description: "Filtra per data",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    )
  }
];

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

  const cardStyle = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" };
  const isExportDisabled = !tid || isPending || (scope === "team" && !selectedTeamId) || (scope === "day" && !selectedDayId);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <header>
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.95)" }}
        >
          Export
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          Esporta calendario in CSV/PDF o stampa con filtri per genere, squadra o giorno.
        </p>
      </header>

      {errorMessage && <div className="sport-alert-error">{errorMessage}</div>}
      {successMessage && <div className="sport-alert-success">{successMessage}</div>}

      {/* Tournament selector */}
      <section className="rounded-xl p-4" style={cardStyle}>
        <label className="flex flex-col gap-1.5 max-w-md">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
            Torneo attivo
          </span>
          <select
            className="sport-select"
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
      </section>

      {/* Scope selector */}
      <section className="rounded-xl p-4 space-y-4" style={cardStyle}>
        <h2
          className="font-bold text-sm uppercase tracking-widest"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}
        >
          Scope di export
        </h2>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {SCOPE_OPTIONS.map((option) => {
            const isActive = scope === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                className="rounded-xl p-3 text-left transition-all duration-200 space-y-2"
                style={{
                  background: isActive ? "rgba(0,230,118,0.1)" : "rgba(255,255,255,0.03)",
                  border: isActive ? "1px solid rgba(0,230,118,0.35)" : "1px solid rgba(255,255,255,0.07)",
                  color: isActive ? "#00e676" : "rgba(255,255,255,0.5)"
                }}
              >
                <div style={{ color: isActive ? "#00e676" : "rgba(255,255,255,0.3)" }}>
                  {option.icon}
                </div>
                <div>
                  <div className="font-semibold text-sm" style={{ fontFamily: "Rajdhani, sans-serif", color: isActive ? "#00e676" : "rgba(255,255,255,0.75)" }}>
                    {option.label}
                  </div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {option.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Team filter */}
        {scope === "team" && (
          <label className="flex flex-col gap-1.5 max-w-md">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Squadra
            </span>
            <select
              className="sport-select"
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
        )}

        {/* Day filter */}
        {scope === "day" && (
          <label className="flex flex-col gap-1.5 max-w-md">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "rgba(255,255,255,0.35)" }}>
              Giorno
            </span>
            <select
              className="sport-select"
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
        )}
      </section>

      {/* Export actions */}
      <section className="rounded-xl p-4 space-y-4" style={cardStyle}>
        <h2
          className="font-bold text-sm uppercase tracking-widest"
          style={{ fontFamily: "Rajdhani, sans-serif", color: "rgba(255,255,255,0.4)", letterSpacing: "0.12em" }}
        >
          Esporta
        </h2>

        <div className="flex flex-wrap gap-3">
          {/* CSV */}
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-5 py-3 font-semibold text-sm transition-all duration-200 disabled:opacity-40"
            style={{
              background: isExportDisabled ? "rgba(255,255,255,0.04)" : "rgba(0,230,118,0.1)",
              border: isExportDisabled ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(0,230,118,0.3)",
              color: isExportDisabled ? "rgba(255,255,255,0.25)" : "#00e676",
              cursor: isExportDisabled ? "not-allowed" : "pointer"
            }}
            onClick={() => void onExportCsv()}
            disabled={isExportDisabled}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            {exportCsvMutation.isPending ? "Esportazione..." : "Esporta CSV"}
          </button>

          {/* PDF */}
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-5 py-3 font-semibold text-sm transition-all duration-200 disabled:opacity-40"
            style={{
              background: isExportDisabled ? "rgba(255,255,255,0.04)" : "rgba(249,115,22,0.1)",
              border: isExportDisabled ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(249,115,22,0.3)",
              color: isExportDisabled ? "rgba(255,255,255,0.25)" : "#f97316",
              cursor: isExportDisabled ? "not-allowed" : "pointer"
            }}
            onClick={() => void onExportPdf()}
            disabled={isExportDisabled}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M9 15v-4h2a2 2 0 0 1 0 4H9z" />
            </svg>
            {exportPdfMutation.isPending ? "Generazione..." : "Esporta PDF"}
          </button>

          {/* Print */}
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-5 py-3 font-semibold text-sm transition-all duration-200 disabled:opacity-40"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.55)"
            }}
            onClick={printScope}
            disabled={isPending}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Stampa
          </button>
        </div>

        <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
          Il file verra scaricato automaticamente nel tuo browser.
        </p>
      </section>
    </div>
  );
}
