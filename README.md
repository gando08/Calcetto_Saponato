# ⚽ Torneo Calcetto Saponato

Applicazione web completa per organizzare tornei di calcetto saponato su campo singolo. Gestisce due sotto-tornei (Maschile e Femminile) con scheduling ottimizzato tramite CP-SAT solver (OR-Tools), classifica in tempo reale, marcatori e export CSV/PDF.

---

## Funzionalità principali

| Area | Funzionalità |
|---|---|
| **Configurazione** | Wizard 4-step: nome torneo, giorni+fasce orarie, regole punti, pesi penalità solver |
| **Squadre** | Creazione manuale, import CSV, preferenze giorni/fasce, indisponibilità per slot |
| **Gironi** | Generazione automatica round-robin, matrice compatibilità, personalizzazione |
| **Calendario** | Solver CP-SAT con progresso WebSocket, drag&drop manuale, lock/unlock partite, report qualità |
| **Risultati** | Inserimento gol e gialli, classifica live con tutti i criteri configurabili |
| **Marcatori** | Ranking marcatori per genere (senza minutaggio) |
| **Bracket** | Generazione eliminazione diretta con cross-seeding, propagazione vincitore/perdente, 3° posto |
| **Export** | CSV completo, PDF con calendario+classifiche+marcatori (WeasyPrint), stampa browser |

---

## Avvio rapido

### ▶ Windows – doppio click (Docker)

Richiede **Docker Desktop** in esecuzione.

1. Doppio click su **`AVVIA_Torneo_App.bat`** → avvia backend + frontend e apre il browser automaticamente
2. Doppio click su **`CHIUDI_Torneo_App.bat`** → ferma tutti i container

### ▶ Windows – locale (senza Docker)

Richiede **Python 3.11–3.13** e **Node.js 18+**.

1. Doppio click su **`AVVIA_Torneo_Locale.bat`** → installa dipendenze (prima volta), avvia backend + frontend e apre il browser
2. Doppio click su **`CHIUDI_Torneo_Locale.bat`** → ferma i processi

### ▶ Docker Compose (cross-platform)

```bash
docker-compose up --build
```

| Servizio | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |

### ▶ Sviluppo locale

**Backend:**

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (in un altro terminale):

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

**Dati demo** (opzionale, con il backend già avviato):

```bash
cd backend
python seed_demo.py
```

---

## Test

```bash
cd backend
py -3.13 -m pytest tests/ -v
```

Attualmente: **27 test**, 0 warning.

---

## Workflow operativo completo

### 1. Configurazione torneo

1. Apri **Configurazione** (sidebar).
2. **Step 1 – Torneo:** nome, durata partite (default 30 min), buffer tra slot (default 0 min).
3. **Step 2 – Gironi:** squadre per girone, quante avanzano, wildcard ON/OFF.
4. **Step 3 – Giorni:** aggiungi i giorni del torneo con date, etichette e fasce orarie. Marca l'ultimo giorno come "giorno finali".
5. **Step 4 – Regole:** punti vittoria/pareggio/sconfitta, ordine tiebreaker, pesi penalità solver.
6. Clicca **Crea torneo** – il backend genera automaticamente tutti gli slot disponibili.

### 2. Squadre

1. Vai su **Squadre**.
2. Aggiungi squadre **manualmente** (nome + genere M/F) oppure **importa CSV** (scarica il template con il pulsante apposito).
3. Per ogni squadra puoi impostare:
   - **Giorni preferiti** (soft constraint, peso configurabile)
   - **Fasce orarie preferite** (soft constraint)
   - **Slot indisponibili** (hard constraint – il solver non assegnerà mai queste partite in quegli slot)

### 3. Gironi

1. Vai su **Gironi**.
2. Clicca **Genera gironi** → algoritmo greedy che massimizza la compatibilità di disponibilità tra squadre dello stesso girone.
3. Visualizza i gironi e la matrice di compatibilità.
4. Il backend genera automaticamente i match round-robin per ogni girone.

### 4. Calendario (scheduling)

1. Vai su **Calendario**.
2. Clicca **Genera calendario** → avvia il solver CP-SAT in background.
   - Il progresso è trasmesso via WebSocket in tempo reale (obiettivo, soluzioni trovate).
3. Quando il solver termina, clicca **Applica soluzione** per salvare gli slot.
4. **Editing manuale:**
   - Trascina una partita da uno slot a un altro (drag & drop).
   - Usa **Lock/Unlock** per impedire che il prossimo solver ri-muova una partita.
5. Il **report qualità** mostra copertura %, partite non assegnate, partite bloccate, eventuali conflitti.

### 5. Risultati e classifiche

1. Vai su **Risultati**.
2. Seleziona il genere (M/F).
3. Inserisci gol e cartellini gialli per ogni partita, clicca **Salva**.
4. Le classifiche si aggiornano in tempo reale con tutti i tiebreaker configurati.
5. Inserisci i marcatori nella sezione dedicata (nome libero, senza necessità di un registro giocatori).

### 6. Bracket (finali)

1. Vai su **Bracket**.
2. Seleziona il genere, clicca **Genera bracket** → cross-seeding automatico (1°A vs 2°B, 1°B vs 2°A).
3. Avanza i vincitori con **Avanza vincitore** – il sistema propaga automaticamente il vincitore al turno successivo e il perdente alla finale 3° posto.

### 7. Export

1. Vai su **Export**.
2. **Scarica CSV** → calendario completo con risultati (compatibile Excel/Fogli Google).
3. **Scarica PDF** → PDF A4 con calendario, classifiche gironi e marcatori (generato server-side con WeasyPrint).
4. **Stampa pagina** → stampa diretta dal browser.

---

## Architettura tecnica

```
.
├── backend/                    # FastAPI + SQLite + OR-Tools
│   ├── app/
│   │   ├── main.py             # FastAPI app, lifespan, middleware, router include
│   │   ├── database.py         # SQLAlchemy engine/session (SQLite)
│   │   ├── models/             # ORM: Tournament, Team, Group, Slot, Match, Result, GoalEvent
│   │   ├── schemas/            # Pydantic v2 schemas (input/output)
│   │   ├── routers/            # REST endpoints + WebSocket
│   │   │   ├── tournaments.py  # CRUD torneo, giorni, slot
│   │   │   ├── teams.py        # CRUD squadre, import CSV
│   │   │   ├── groups.py       # Generazione gironi, compatibilità
│   │   │   ├── schedule.py     # WebSocket solver, genera/applica/qualità
│   │   │   ├── results.py      # Risultati + eventi gol
│   │   │   ├── standings.py    # Classifiche + marcatori
│   │   │   ├── bracket.py      # Bracket eliminazione diretta
│   │   │   └── export_router.py # CSV + PDF (WeasyPrint)
│   │   ├── services/           # Logica business
│   │   │   ├── slot_generator.py    # Genera slot da finestre orarie
│   │   │   ├── round_robin.py       # Accoppiamenti gironi
│   │   │   ├── standings_calculator.py # Classifica con tiebreaker
│   │   │   ├── group_builder.py     # Costruzione gironi greedy
│   │   │   ├── bracket_generator.py # Bracket eliminazione diretta
│   │   │   └── scheduler.py         # Orchestrazione solver
│   │   └── solver/             # OR-Tools CP-SAT
│   │       ├── cp_sat_solver.py     # TournamentScheduler (thread + callback)
│   │       ├── constraints.py       # Hard/soft constraint helpers
│   │       └── penalty_system.py    # PenaltySystem con pesi configurabili
│   ├── tests/                  # 27 pytest (unit + integration)
│   ├── data/                   # Demo config JSON + CSV squadre
│   ├── seed_demo.py            # Seeder via HTTP API
│   └── requirements.txt
│
├── frontend/                   # React 18 + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── api/client.ts       # Axios client per tutti gli endpoint
│   │   ├── store/tournament.ts # Zustand store (torneo corrente)
│   │   ├── types/index.ts      # TypeScript interfaces
│   │   ├── components/layout/  # Sidebar + AppLayout
│   │   └── pages/              # 8 pagine React
│   │       ├── Dashboard.tsx       # KPI + top marcatori + prossime partite
│   │       ├── TournamentSetup.tsx # Wizard creazione torneo
│   │       ├── Teams.tsx           # Gestione squadre
│   │       ├── Groups.tsx          # Gironi + compatibilità
│   │       ├── Schedule.tsx        # Calendario drag&drop + WebSocket solver
│   │       ├── Results.tsx         # Risultati + classifiche + marcatori
│   │       ├── Bracket.tsx         # Bracket finali
│   │       └── Export.tsx          # Export CSV/PDF/stampa
│   ├── Dockerfile              # Multi-stage: build → nginx
│   └── nginx.conf              # Proxy /api e /ws → backend:8000
│
├── docker-compose.yml          # backend:8000 + frontend:3000 (nginx)
├── AVVIA_Torneo_App.bat        # Launcher Windows (Docker)
├── AVVIA_Torneo_Locale.bat     # Launcher Windows (locale)
└── README.md
```

### Solver CP-SAT

Il solver usa **OR-Tools CP-SAT** per assegnare ogni partita a uno slot:

- **Variabili:** `assigned[match_id, slot_id] ∈ {0, 1}`
- **Vincoli hard:**
  - Ogni partita assegnata a esattamente uno slot
  - Ogni slot contiene al massimo una partita
  - Slot di indisponibilità delle squadre non usabili
  - Partite già bloccate manualmente non ri-schedulate
- **Vincoli soft (penalità minimizzate):**
  - `pref_day_violation` – partita non nel giorno preferito dalla squadra
  - `pref_window_violation` – partita fuori fascia oraria preferita
  - `consecutive_penalty` – squadra gioca in slot non consecutivi (se `prefers_consecutive`)
  - `equity_imbalance` – distribuzione non equa dei giorni tra le squadre
  - `finals_day_preference` – partita di fase finale non nel giorno finali (peso default 20)

### Stack tecnologico

| Layer | Tecnologia |
|---|---|
| Backend | Python 3.11+, FastAPI 0.115, SQLAlchemy 2.0, Pydantic v2 |
| Database | SQLite (file locale) |
| Solver | OR-Tools 9.11 (CP-SAT) |
| PDF | WeasyPrint 62 |
| Frontend | React 18, TypeScript, Vite 5, TailwindCSS 3 |
| State | Zustand 5, TanStack Query 5 |
| DnD | @dnd-kit/core + @dnd-kit/sortable |
| Deploy | Docker Compose (nginx + uvicorn) |

---

## Configurazione avanzata

### Pesi penalità solver

Dal wizard di configurazione (Step 4) o modificando direttamente il torneo:

| Chiave | Default | Descrizione |
|---|---|---|
| `pref_day` | 10 | Penalità per giorno non preferito |
| `pref_window` | 5 | Penalità per fascia non preferita |
| `consecutive` | 3 | Penalità per slot non consecutivi |
| `equity` | 8 | Penalità per squilibrio distribuzione giorni |
| `finals_day` | 20 | Penalità per finale non nel giorno finali |

### Ordine tiebreaker

Default: `head_to_head → goal_diff → goals_for → goals_against → fair_play → draw`

Tutti configurabili dal wizard.

### Importazione squadre CSV

Template scaricabile dalla pagina Squadre. Campi:

```
nome,genere,giorni_preferiti,fasce_preferite,indisponibilita
Team Alpha,M,1;2,10:00-13:00,
Team Beta,F,,,Giorno 2
```

- `giorni_preferiti`: numeri separati da `;` (es. `1;3`)
- `fasce_preferite`: fasce `HH:MM-HH:MM` separate da `;`
- `indisponibilita`: etichette dei giorni separati da `;`

---

## API Reference

La documentazione interattiva Swagger è disponibile su `http://localhost:8000/docs`.

Principali endpoint:

```
GET  /api/tournaments                    Lista tornei
POST /api/tournaments                    Crea torneo
POST /api/tournaments/{id}/days          Aggiungi giorno (genera slot)
GET  /api/tournaments/{id}/slots         Lista slot disponibili

POST /api/tournaments/{id}/teams         Crea squadra
POST /api/tournaments/{id}/teams/import  Import CSV squadre

POST /api/tournaments/{id}/groups/generate  Genera gironi + round-robin
GET  /api/tournaments/{id}/groups/compatibility  Matrice compatibilità

WS   /api/tournaments/ws/{id}/solver     WebSocket progresso solver
POST /api/tournaments/{id}/schedule/generate  Avvia solver
POST /api/tournaments/{id}/schedule/apply     Applica soluzione
GET  /api/tournaments/{id}/schedule/quality   Report qualità calendario
GET  /api/tournaments/{id}/schedule           Lista partite con slot

POST /api/matches/{mid}/result           Salva risultato
POST /api/matches/{mid}/goals            Aggiungi marcatore
PATCH /api/matches/{mid}/slot            Sposta partita (manuale)
PATCH /api/matches/{mid}/lock            Lock/unlock partita

GET  /api/tournaments/{id}/standings/{gender}   Classifica gironi
GET  /api/tournaments/{id}/standings/scorers    Marcatori

POST /api/tournaments/{id}/bracket/{gender}        Genera bracket
POST /api/tournaments/{id}/bracket/{gender}/advance  Avanza vincitore

GET  /api/tournaments/{id}/export/csv   Export CSV
GET  /api/tournaments/{id}/export/pdf   Export PDF (WeasyPrint)
```
