import { useEffect, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";

import { tournamentApi } from "../api/client";
import { useTournamentStore } from "../store/tournament";

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

  const exportCsvMutation = useMutation({
    mutationFn: () => tournamentApi.exportCsv(tid)
  });

  const onExportCsv = async () => {
    if (!tid) {
      setErrorMessage("Seleziona prima un torneo.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await exportCsvMutation.mutateAsync();
      const fallback = `calendario_${tid}.csv`;
      const filename = extractFilename(response.headers?.["content-disposition"] as string | undefined, fallback);
      downloadBlobFile(response.data as Blob, filename);
      setSuccessMessage(`Export completato: ${filename}`);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : "Errore durante l'export CSV.");
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Export</h1>
          <p className="text-slate-600">Scarica il calendario partite in CSV e usa la stampa browser per report veloci.</p>
        </div>
      </header>

      {errorMessage ? <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded">{errorMessage}</div> : null}
      {successMessage ? <div className="bg-green-100 border border-green-300 text-green-700 p-3 rounded">{successMessage}</div> : null}

      <section className="bg-white p-4 rounded shadow flex flex-wrap gap-3 items-end">
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
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <button
          className="px-3 py-2 border rounded"
          type="button"
          onClick={() => void onExportCsv()}
          disabled={!tid || exportCsvMutation.isPending}
        >
          {exportCsvMutation.isPending ? "Esportazione..." : "Scarica CSV"}
        </button>

        <button className="px-3 py-2 border rounded" type="button" onClick={() => window.print()}>
          Stampa pagina
        </button>
      </section>

      <section className="bg-white p-4 rounded shadow text-sm text-slate-700 space-y-2">
        <p>
          Endpoint attivo CSV:
          {" "}
          <code>{tid ? `/api/tournaments/${tid}/export/csv` : "/api/tournaments/{id}/export/csv"}</code>
        </p>
        <p>Export PDF per vista squadra/giorno non ancora disponibile in backend.</p>
      </section>
    </div>
  );
}
