# Design Document — Setup, Squadre e Calendario Avanzato
**Data:** 2026-03-03  
**Stato:** Approvato  
**Scope:** Incremento UI avanzata per flusso operativo base (`Setup -> Squadre -> Calendario`) con editing manuale completo.

---

## 1. Obiettivo Incremento

Completare il primo percorso operativo realmente usabile in produzione evento:
- configurare torneo e giorni/finestre orarie da interfaccia guidata
- gestire squadre e preferenze con CRUD/import
- generare calendario via solver e modificarlo manualmente con drag&drop
- bloccare/sbloccare partite per prevenire rescheduling indesiderato

---

## 2. Approccio Scelto

Approccio architetturale: **ibrido (frontend ottimista + backend autoritativo)**.

Scelte:
1. Ogni azione utente sul calendario persiste immediatamente lato server.
2. UI aggiornata in modo ottimistico per fluidità.
3. In caso di errore API: rollback locale + notifica utente.
4. Stato finale sempre riallineato dal backend (source of truth).

Motivazione:
- mantiene UX avanzata (drag&drop reattivo)
- evita inconsistenze di lungo periodo
- limita complessità rispetto a un modello full-local batch-save

---

## 3. Design Funzionale

### 3.1 TournamentSetup
- Wizard multi-step:
  - Dati torneo
  - Punteggi e tiebreak
  - Giorni + finestre
  - Riepilogo e conferma
- Alla conferma:
  - `POST /api/tournaments`
  - `POST /api/tournaments/{id}/days` per ogni giorno
- In ogni step: validazione campi obbligatori e limiti numerici.

### 3.2 Teams
- Tabella con filtro genere (M/F/All).
- Azioni:
  - creazione/modifica/cancellazione team
  - import CSV
  - template CSV scaricabile
- Editor preferenze in drawer:
  - giorni preferiti
  - finestre preferite
  - indisponibilità slot
  - flag consecutività.

### 3.3 Schedule (avanzato)
- Comandi principali:
  - Genera calendario
  - Stato solver
  - Applica soluzione
- Vista per giorno con slot come drop target.
- Card match draggable.
- Toggle lock/unlock match.
- Vincoli UX:
  - match locked non trascinabile
  - drop consentito solo su slot libero
  - operazione atomica per singolo match.

---

## 4. Data Flow

### 4.1 Generazione calendario
1. UI invia `POST /schedule/generate`.
2. Solver parte in background.
3. Progress inviato via WebSocket.
4. UI mostra stato e disponibilità bottone `Applica`.
5. `POST /schedule/apply` assegna slot e marca partite schedulate.
6. UI ricarica lista schedule.

### 4.2 Editing manuale
1. Drag start su card match non locked.
2. Drop su slot target libero.
3. UI applica optimistic move.
4. Persistenza API (`reassign match slot`).
5. Successo: stato confermato.
6. Fallimento: rollback + toast errore.

### 4.3 Lock/Unlock
1. Click lock su match.
2. UI aggiorna stato lock ottimisticamente.
3. Persistenza API.
4. Errore: rollback lock state + toast.

---

## 5. Contratti API da Integrare/Estendere

Già presenti:
- `POST /api/tournaments`
- `POST /api/tournaments/{tid}/days`
- `GET /api/tournaments/{tid}/slots`
- `POST /api/tournaments/{tid}/schedule/generate`
- `GET /api/tournaments/{tid}/schedule/status`
- `POST /api/tournaments/{tid}/schedule/apply`
- `GET /api/tournaments/{tid}/schedule`
- CRUD teams + import CSV

Da aggiungere per editing manuale completo:
1. `PATCH /api/matches/{mid}/slot` (assegna/sposta match su slot)
2. `PATCH /api/matches/{mid}/lock` (lock/unlock)
3. validazioni server:
   - slot libero
   - match esistente
   - slot esistente
   - match lockato non modificabile se non da endpoint lock.

---

## 6. Error Handling

- Errori API mostrati con messaggi user-friendly in italiano.
- Retry manuale su operazioni non critiche.
- Fallback schedule polling se WebSocket non disponibile.
- Stato loading per action button (evita doppi click).

---

## 7. Testing Strategy

Backend:
1. test endpoint `PATCH /slot`:
   - successo
   - slot occupato
   - match lockato
2. test endpoint `PATCH /lock`.
3. regressione su schedule esistente.

Frontend:
1. test hook mutation:
   - optimistic update
   - rollback su errore
2. test DnD behavior base (drag abilitato/disabilitato).
3. smoke build e navigazione route principali.

---

## 8. Non-Obiettivi di Questo Incremento

- Ottimizzazione visuale avanzata bracket/results/export.
- Gestione multi-torneo concorrente in UI.
- Notifiche realtime cross-client oltre progresso solver.

---

## 9. Criteri di Accettazione

1. Posso creare un torneo completo via wizard.
2. Posso inserire/importare squadre con preferenze.
3. Posso generare calendario e applicarlo.
4. Posso spostare partite con drag&drop in modo persistente.
5. Posso lockare/sbloccare partite.
6. In caso di errore persistenza, la UI torna coerente (rollback).
