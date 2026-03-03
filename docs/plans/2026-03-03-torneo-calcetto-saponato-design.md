# Design Document — Torneo Calcetto Saponato
**Data:** 2026-03-03
**Stato:** Approvato
**Approccio scelto:** A — FastAPI + React + SQLite + Thread pool + WebSocket

---

## 1. Contesto e Obiettivo

Applicazione web professionale per organizzare tornei di calcetto saponato con:
- Due sottotornei distinti: **Maschile** e **Femminile**
- Un **solo campo** disponibile (no sovrapposizioni di slot)
- Scheduling ottimizzato via **OR-Tools CP-SAT**
- UI interattiva con drag & drop, risultati live, classifica e marcatori

---

## 2. Assunzioni Documentate

| # | Assunzione | Motivazione |
|---|---|---|
| A1 | Deploy locale (localhost), singola istanza | Uso eventi, nessun multi-tenancy |
| A2 | SQLite come database | Zero infrastruttura, persistenza tra riavvii, adatto a uso locale |
| A3 | Nessuna autenticazione | App aperta a tutti gli organizzatori presenti all'evento |
| A4 | Solver timeout configurabile (default 300s, max illimitato) | Richiesta esplicita utente |
| A5 | Wild card opzionale e configurabile (ON/OFF + N migliori secondi) | Flessibilità per diversi formati |
| A6 | Single elimination + finale 3° posto per M e F | Richiesta esplicita |
| A7 | PDF generato da WeasyPrint (backend) + stampa browser (frontend) | Entrambe le modalità richieste |
| A8 | UI solo in italiano | Nessuna i18n necessaria |
| A9 | Modifica manuale → rescheduling parziale automatico via CP-SAT | Richiesta esplicita |
| A10 | Import squadre da CSV + inserimento manuale da UI | Entrambe le modalità |
| A11 | Criteri spareggio: scontro diretto → diff reti → GF → GS → fair play → sorteggio | Ordine configurabile |
| A12 | Gestione risultati + classifica live inclusa | Richiesta esplicita |
| A13 | Classifica marcatori inclusa (senza minutaggio) | Richiesta esplicita |
| A14 | `finals_days` come soft constraint (peso alto default=20), non hard | Flessibilità scheduling concordata |

---

## 3. Architettura

```
[Browser]
   │
   ├── REST (Axios + React Query)
   └── WebSocket (progress solver + live updates)
         │
   [FastAPI Backend]
         ├── SQLAlchemy ORM → SQLite
         ├── OR-Tools CP-SAT (thread pool)
         ├── WeasyPrint (PDF)
         └── Servizio export CSV
```

**Stack:**
- Backend: Python 3.11+, FastAPI, SQLAlchemy, OR-Tools, WeasyPrint, Pydantic v2
- Frontend: React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Zustand, React Query, DnD Kit, Recharts
- DB: SQLite (file `tournament.db`)
- Container: Docker Compose (2 servizi: `backend`, `frontend`)

---

## 4. Struttura Directory

```
calcetto-saponato/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── models/
│   │   │   ├── tournament.py
│   │   │   ├── team.py
│   │   │   ├── group.py
│   │   │   ├── match.py
│   │   │   ├── slot.py
│   │   │   ├── result.py
│   │   │   ├── goal_event.py
│   │   │   └── player.py
│   │   ├── schemas/
│   │   ├── routers/
│   │   │   ├── tournaments.py
│   │   │   ├── teams.py
│   │   │   ├── schedule.py
│   │   │   ├── results.py
│   │   │   ├── standings.py
│   │   │   ├── bracket.py
│   │   │   └── export.py
│   │   ├── services/
│   │   │   ├── group_builder.py
│   │   │   ├── round_robin.py
│   │   │   ├── bracket_generator.py
│   │   │   ├── scheduler.py
│   │   │   ├── standings_calculator.py
│   │   │   └── scorers_calculator.py
│   │   ├── solver/
│   │   │   ├── cp_sat_solver.py
│   │   │   ├── penalty_system.py
│   │   │   └── constraints.py
│   │   └── utils/
│   │       ├── pdf_generator.py
│   │       ├── csv_importer.py
│   │       └── equity_analyzer.py
│   ├── tests/
│   │   ├── test_slot_generation.py
│   │   ├── test_round_robin.py
│   │   ├── test_constraints.py
│   │   ├── test_standings.py
│   │   └── test_scorers.py
│   ├── data/
│   │   ├── demo_teams.csv
│   │   └── demo_config.json
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── tournament/
│   │   │   ├── schedule/
│   │   │   ├── results/
│   │   │   ├── scorers/
│   │   │   └── export/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── TournamentSetup.tsx
│   │   │   ├── Teams.tsx
│   │   │   ├── Groups.tsx
│   │   │   ├── Schedule.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Standings.tsx
│   │   │   ├── Scorers.tsx
│   │   │   └── Bracket.tsx
│   │   ├── hooks/
│   │   ├── api/
│   │   ├── store/
│   │   └── types/
│   ├── package.json
│   └── Dockerfile
├── docs/
│   └── plans/
├── docker-compose.yml
└── README.md
```

---

## 5. Modello Dati (SQLite)

### Tournament
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| name | str | Nome torneo |
| status | enum | setup / groups / scheduled / ongoing / finished |
| total_days | int | Default 4 |
| match_duration_minutes | int | Default 30 |
| buffer_minutes | int | Default 0 |
| teams_per_group | int | Default 4 |
| teams_advancing_per_group | int | Default 2 |
| wildcard_enabled | bool | Default False |
| wildcard_count | int | Default 0 |
| points_win | int | Default 3 |
| points_draw | int | Default 1 |
| points_loss | int | Default 0 |
| tiebreaker_order | JSON | Lista criteri ordinata |
| penalty_weights | JSON | Pesi solver configurabili |

### Day
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| tournament_id | UUID | FK |
| date | date | |
| label | str | es. "Giorno 1" |
| is_finals_day | bool | Preferenza finali (soft) |
| time_windows | JSON | [{start, end}, ...] |

### Slot
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| day_id | UUID | FK |
| start_time | time | |
| end_time | time | |
| is_occupied | bool | |

### Team
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| tournament_id | UUID | FK |
| name | str | |
| gender | enum | M / F |
| preferred_days | JSON | Lista day_id (soft) |
| preferred_time_windows | JSON | [{start, end}] (soft) |
| unavailable_slot_ids | JSON | Lista slot_id (hard) |
| prefers_consecutive | bool | Default False |

### Player
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| team_id | UUID | FK |
| name | str | Testo libero |

### Group
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| tournament_id | UUID | FK |
| name | str | es. "Girone A" |
| gender | enum | M / F |
| phase | enum | group / final |

### Match
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| group_id | UUID | FK |
| slot_id | UUID | FK nullable |
| team_home_id | UUID | FK nullable (placeholder finali) |
| team_away_id | UUID | FK nullable |
| placeholder_home | str | es. "Vincitore Girone A" |
| placeholder_away | str | |
| phase | enum | group / quarter / semi / third / final |
| round | int | Numero round nel bracket |
| status | enum | pending / scheduled / played |
| is_manually_locked | bool | Blocca rescheduling automatico |

### Result
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| match_id | UUID | FK unique |
| goals_home | int | |
| goals_away | int | |
| yellow_home | int | Per fair play |
| yellow_away | int | |

### GoalEvent
| Campo | Tipo | Note |
|---|---|---|
| id | UUID | PK |
| match_id | UUID | FK |
| player_id | UUID | FK nullable |
| player_name_free | str | Testo libero se no player_id |
| is_own_goal | bool | Default False |
| attributed_to_team_id | UUID | FK (team a cui si attribuisce il gol) |

---

## 6. API REST

### Torneo
```
POST   /api/tournaments
GET    /api/tournaments
GET    /api/tournaments/{id}
PUT    /api/tournaments/{id}
DELETE /api/tournaments/{id}
```

### Giorni & Slot
```
POST   /api/tournaments/{id}/days
GET    /api/tournaments/{id}/days
PUT    /api/tournaments/{id}/days/{day_id}
DELETE /api/tournaments/{id}/days/{day_id}
GET    /api/tournaments/{id}/slots
```

### Squadre
```
POST   /api/tournaments/{id}/teams
GET    /api/tournaments/{id}/teams
PUT    /api/tournaments/{id}/teams/{team_id}
DELETE /api/tournaments/{id}/teams/{team_id}
POST   /api/tournaments/{id}/teams/import       # Upload CSV
GET    /api/tournaments/{id}/teams/csv-template  # Download template
```

### Gironi
```
POST   /api/tournaments/{id}/groups/generate
GET    /api/tournaments/{id}/groups
PUT    /api/tournaments/{id}/groups/{gid}
PUT    /api/tournaments/{id}/groups/{gid}/teams  # Modifica composizione
GET    /api/tournaments/{id}/groups/compatibility # Matrice compatibilità
```

### Scheduling
```
POST   /api/tournaments/{id}/schedule/generate
GET    /api/tournaments/{id}/schedule/status
GET    /api/tournaments/{id}/schedule
GET    /api/tournaments/{id}/schedule/quality
PATCH  /api/tournaments/{id}/matches/{mid}/slot  # Sposta manuale
PUT    /api/tournaments/{id}/matches/{mid}/lock   # Blocca/sblocca match
```

### Bracket Finali
```
POST   /api/tournaments/{id}/bracket/generate
GET    /api/tournaments/{id}/bracket
PUT    /api/tournaments/{id}/bracket/advance     # Avanza squadra
```

### Risultati
```
POST   /api/matches/{id}/result
PUT    /api/matches/{id}/result
GET    /api/matches/{id}/result
POST   /api/matches/{id}/goals                   # Aggiunge marcatore
DELETE /api/goals/{goal_id}
```

### Classifiche
```
GET    /api/tournaments/{id}/standings/{gender}
GET    /api/tournaments/{id}/standings/wildcard
GET    /api/tournaments/{id}/standings/scorers
```

### Export
```
GET    /api/tournaments/{id}/export/csv
GET    /api/tournaments/{id}/export/pdf
GET    /api/tournaments/{id}/export/pdf?view=team&team_id={x}
GET    /api/tournaments/{id}/export/pdf?view=day&day_id={x}
```

### WebSocket
```
WS  /ws/tournaments/{id}/solver   # Progress solver (percentuale, stato, ETA)
WS  /ws/tournaments/{id}/live     # Aggiornamenti live risultati/bracket
```

---

## 7. Algoritmo CP-SAT

### Step 1 — Generazione Slot
```
Per ogni Day → Per ogni TimeWindow:
  genera slot consecutivi di match_duration_minutes + buffer_minutes
Output: lista ordinata Slot
```

### Step 2 — Costruzione Gironi
```
Algoritmo greedy per genere (M/F separati):
1. Calcola overlap_score(team_i, team_j) = intersezione disponibilità / totale slot
2. Assegna squadre a gironi massimizzando overlap_score medio intra-girone
Output: gironi + matrice compatibilità (esposta via API)
```

### Step 3 — Round-Robin
```
Per ogni girone: combinazioni(n, 2) → lista Match
```

### Step 4 — CP-SAT Solver

**Variabili:**
```python
assigned[m, s] ∈ {0, 1}   # match m assegnato a slot s
```

**Vincoli Hard:**
1. Ogni match assegnato a esattamente 1 slot
2. Ogni slot ha al massimo 1 match (unico campo)
3. Nessun match in slot con indisponibilità di una delle due squadre
4. Dipendenza sequenziale finali: `slot(finale) > max(slot(prerequisiti))`
5. Match bloccati manualmente: slot fisso

**Funzione Obiettivo (minimizza penalty):**
```python
penalty = Σ weights[k] * violation_k

# Violazioni soft:
# pref_day_violation      (default 10): match in giorno non preferito
# pref_window_violation   (default  8): match in fascia non preferita
# consecutive_penalty     (default  5): due match consecutivi (se !prefers_consecutive)
# rest_violation          (default 15): meno di min_rest_slots tra partite
# equity_imbalance        (default  3): squilibrio distribuzione slot
# finals_day_preference   (default 20): finale fuori da finals_day
```

### Step 5 — Bracket Finali
```
Input: gironi, teams_advancing_per_group, wildcard_config
Output: bracket single elimination con seeding incrociato
  1°A vs 2°B, 1°B vs 2°A, ecc.
  + Finale 3° posto auto-generata
  + Slot placeholder per fasi future
```

### Step 6 — Rescheduling Parziale (modifica manuale)
```
1. Utente sposta match M da slot S1 a S2
2. Se S2 occupato → trova primo slot libero compatibile per match occupante
3. Riesegui CP-SAT solo su match non bloccati manualmente
4. Restituisci nuovo calendario + delta violazioni
```

---

## 8. UI — Pagine e Componenti

### Stack
- React 18 + TypeScript + Vite
- TailwindCSS + shadcn/ui
- Zustand (state globale)
- React Query (cache + refetch automatico)
- DnD Kit (drag & drop calendario)
- Recharts (grafici KPI)

### Pagine
1. **Dashboard** — KPI cards, timeline giorno corrente, alert violazioni, stato solver
2. **Configurazione** — Stepper 4 step (info base → fasce → formato → pesi)
3. **Squadre** — Tabella ordinabile, drawer preferenze, import CSV
4. **Gironi** — Drag & drop composizione, matrice heatmap compatibilità
5. **Calendario** — 3 viste (Giorno / Squadra / Girone), drag & drop match
6. **Risultati & Classifiche** — Inserimento risultati + marcatori, classifica girone, wild card
7. **Classifica Marcatori** — Podio + tabella, filtro genere/girone
8. **Bracket Finali** — Visualizzazione bracket, avanzamento squadre
9. **Export** — Selezione scope + formato (CSV / PDF / Stampa)

### Badge Stato Match
- 🟢 Schedulato OK
- 🟡 Soft violation
- 🔴 Hard violation / conflitto
- ⚫ Non schedulato

### KPI Dashboard
- % preferenze rispettate
- N violazioni hard / soft
- Slot utilizzati / totali
- Indice equità (0-1)

---

## 9. Vincoli di Equità

```python
equity_index = 1 - std_dev(slot_positions_per_team) / max_possible_std_dev
```
- `slot_position`: posizione normalizzata dello slot nel giorno (0=primo, 1=ultimo)
- Penalty se una squadra ha std_dev bassa (sempre stesso orario)
- Visualizzato come indice 0-1 nella dashboard

---

## 10. Export

### CSV
- Calendario completo: data, orario, squadra_casa, squadra_ospite, fase, risultato
- Classifica: posizione, squadra, G/V/P/S/GF/GS/DR/Pt
- Marcatori: giocatore, squadra, gol

### PDF (WeasyPrint)
- Template HTML/CSS → PDF
- Viste: calendario completo, per squadra, per giorno
- Header con logo torneo, footer con timestamp

---

## 11. Test Unitari

| File | Cosa testa |
|---|---|
| `test_slot_generation.py` | Generazione slot da time windows, buffer, bordi |
| `test_round_robin.py` | Numero match corretto, no duplicati, no auto-match |
| `test_constraints.py` | Vincoli hard rispettati, penalty soft calcolate correttamente |
| `test_standings.py` | Classifica, spareggi, wild card |
| `test_scorers.py` | Conteggio gol, esclusione autogol, ordinamento |

---

## 12. Demo Dataset

### `demo_config.json`
```json
{
  "name": "Torneo Estate 2026",
  "total_days": 4,
  "finals_days": [3, 4],
  "match_duration_minutes": 30,
  "buffer_minutes": 5,
  "teams_per_group": 4,
  "teams_advancing_per_group": 2,
  "wildcard_enabled": true,
  "wildcard_count": 2,
  "points_win": 3,
  "points_draw": 1,
  "points_loss": 0
}
```

### `demo_teams.csv`
```csv
nome,genere,giorni_preferiti,fasce_preferite,indisponibilita
Team Alpha,M,1;2,10:00-13:00,
Team Beta,M,1;3,,Giorno 2
...
Tigri Rosa,F,1;2,15:00-19:00,
```

---

## 13. Docker Compose

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes: ["./backend/data:/app/data"]
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend]
```

---

*Design approvato il 2026-03-03. Procede con writing-plans.*
