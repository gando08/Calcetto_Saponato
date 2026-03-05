# Design: coppia tornei M/F, calendario unificato e salvataggio continuo

Data: 2026-03-05
Stato: approvato

## 1. Obiettivo

Rendere la gestione della coppia tornei M/F coerente e operativa su campo unico:

- nomi torneo riconoscibili quando si crea la coppia;
- calendario M/F sempre generato insieme, senza sovrapposizioni;
- rimozione filtro genere dai tab principali dove non serve;
- possibilità di annullare assegnazioni (singola o totale) prima del salvataggio;
- calendario sempre modificabile anche dopo salvataggio;
- protezione delle partite già giocate;
- riduzione perdita dati in inserimento risultati tramite autosave.

## 2. Scope funzionale approvato

### 2.1 Configurazione torneo

- In creazione coppia M/F, i nomi sono espliciti:
  - `<Nome base> <Anno> - Maschile`
  - `<Nome base> <Anno> - Femminile`
- Femminile con default iniziale `2 gironi x 3 squadre`.
- Il default è modificabile.
- Vincolo: nel femminile i gironi devono sempre avere uguale numero di squadre.
- Se il numero squadre non consente bilanciamento perfetto, usare completamento con `BYE`.

### 2.2 UI senza filtro genere superfluo

- Rimuovere filtro/toggle M/F da:
  - `Squadre`
  - `Calendario`
  - `Risultati`
- Vista unica di edizione/coppia, mantenendo badge colore/label per distinguere M e F.
- `Bracket` resta a due colonne separate (M/F), senza toggle extra.

### 2.3 Calendario

- Rimuovere opzione `Pianifica insieme a`.
- `Genera calendario` deve pianificare automaticamente entrambi i tornei della coppia.
- Prima di salvare:
  - annulla assegnazione singola -> match non schedulato;
  - annulla tutte le assegnazioni -> tutti i match non giocati tornano non schedulati.
- Un solo pulsante `Salva calendario`.
- Anche dopo il salvataggio, il calendario resta modificabile.
- Le partite `PLAYED` non devono essere modificabili.

### 2.4 Risultati e marcatori

- Marcatori: persistono subito su DB come oggi.
- Aggiungere autosave con debounce su risultato/falli per ridurre perdita dati in caso crash.

## 3. Architettura proposta

### 3.1 Backend scheduling pair-aware

- Il backend risolve automaticamente il torneo companion della coppia M/F a partire da `tid`.
- La UI non deve più decidere manualmente se includere il companion.
- Il solver continua a:
  - vincolare massimo una partita per slot;
  - vincolare massimo una partita per stesso `date + start_time` tra tornei diversi.

### 3.2 Nuove operazioni calendario

- `PATCH /api/matches/{mid}/unschedule`
  - porta la partita a non schedulata (`slot_id = null`, stato pending se non played).
- `POST /api/tournaments/{tid}/schedule/unschedule-all`
  - unschedule di tutte le partite non giocate di coppia.
- `POST /api/tournaments/{tid}/schedule/save`
  - persistenza esplicita dello stato corrente calendario.

Nota: non esiste stato finale bloccante; `save` è checkpoint operazionale.

### 3.3 Guardrail su partite giocate

- Bloccare lato backend modifiche calendario su partite `PLAYED`:
  - spostamento slot;
  - lock/unlock;
  - unschedule singolo;
  - unschedule massivo (deve saltare `PLAYED`).

### 3.4 Bilanciamento femminile con BYE

- In generazione gruppi femminili:
  - calcolo numero gruppi e capienza uniforme;
  - inserimento placeholder `BYE` se necessario;
  - esclusione match BYE dalla pianificazione reale.

## 4. Data flow sintetico

1. Utente seleziona edizione coppia.
2. `Genera calendario` avvia solver su M+F automaticamente.
3. UI mostra bozza combinata, distinta solo da badge genere.
4. Utente può:
   - spostare match non `PLAYED`,
   - annullare singola assegnazione,
   - annullare tutte le assegnazioni non `PLAYED`.
5. `Salva calendario` persiste lo stato corrente.
6. Utente può continuare a modificare e salvare nuovamente.

## 5. Error handling

- `400` su tentativo modifica match `PLAYED`.
- Messaggi UI espliciti per:
  - slot occupato,
  - partita bloccata,
  - partita già giocata non modificabile,
  - impossibilità operazione bulk parziale.
- In autosave risultato:
  - retry manuale possibile tramite pulsante `Salva`.
  - dedup richieste per evitare flood.

## 6. Strategia test

### 6.1 Backend

- Scheduler coppia: nessuna sovrapposizione cross-torneo sullo stesso orario reale.
- Endpoint `unschedule` singolo/tutti:
  - funzionano su `pending/scheduled`;
  - rifiutano `played`.
- `save` mantiene consistenza dati dopo refresh.
- Gruppi femminili:
  - 6 squadre -> 2x3;
  - 5 squadre -> bilanciamento con BYE.

### 6.2 Frontend

- Nessun filtro genere in `Squadre/Calendario/Risultati`.
- Calendario unico con badge M/F.
- `Annulla assegnazione` singola/tutte aggiornano subito UI.
- `Salva calendario` non blocca successive modifiche.
- Autosave risultati:
  - modifica campi -> persistenza post reload;
  - crash simulato dopo modifica -> perdita minimizzata.

## 7. Rischi e mitigazioni

- Rischio regressioni da assunzioni single-tournament:
  - introdurre helper centralizzato per contesto coppia.
- Rischio BYE in classifiche/risultati:
  - marcare placeholder e filtrarli da scheduling/statistiche reali.
- Rischio eccesso richieste autosave:
  - debounce + invio solo su variazioni reali.

## 8. Decisioni finali approvate

- Unico pulsante `Salva calendario`.
- Nessun concetto di “definitivo non modificabile”.
- Partite giocate protette da modifiche calendario.
- Default femminile `2x3` modificabile.
- Gironi femminili sempre bilanciati, con BYE se necessario.
