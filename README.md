# âš½ Torneo Calcetto Saponato

Applicazione web completa per organizzare tornei di calcetto saponato su campo singolo. Gestisce due sotto-tornei (Maschile e Femminile) con scheduling ottimizzato tramite CP-SAT solver (OR-Tools), classifica in tempo reale, marcatori e export CSV/PDF.

---

## FunzionalitÃ  principali

| Area | FunzionalitÃ  |
|---|---|
| **Configurazione** | Wizard 4-step: nome torneo, giorni+fasce orarie, regole punti, pesi penalitÃ  solver |
| **Squadre** | Creazione manuale, import CSV, preferenze giorni/fasce, indisponibilitÃ  per slot |
| **Gironi** | Generazione automatica round-robin, matrice compatibilitÃ , personalizzazione |
| **Calendario** | Solver CP-SAT con progresso WebSocket, drag&drop manuale, lock/unlock partite, report qualitÃ  |
| **Risultati** | Inserimento gol e gialli, classifica live con tutti i criteri configurabili |
| **Marcatori** | Ranking marcatori per genere (senza minutaggio) |
| **Bracket** | Generazione eliminazione diretta con cross-seeding, propagazione vincitore/perdente, 3Â° posto |
| **Export** | CSV completo, PDF con calendario+classifiche+marcatori (WeasyPrint), stampa browser |

---

## Avvio rapido

### â–¶ Docker Compose (cross-platform)

```bash
docker-compose up --build
```

| Servizio | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger Docs | http://localhost:8000/docs |

### â–¶ Sviluppo locale

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
npm run dev        # â†’ http://localhost:5173
```

**Dati demo** (opzionale, con il backend giÃ  avviato):

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
2. **Step 1 â€“ Torneo:** nome, durata partite (default 30 min), buffer tra slot (default 0 min).
3. **Step 2 â€“ Gironi:** squadre per girone, quante avanzano, wildcard ON/OFF.
4. **Step 3 â€“ Giorni:** aggiungi i giorni del torneo con date, etichette e fasce orarie. Marca l'ultimo giorno come "giorno finali".
5. **Step 4 â€“ Regole:** punti vittoria/pareggio/sconfitta, ordine tiebreaker, pesi penalitÃ  solver.
6. Clicca **Crea torneo** â€“ il backend genera automaticamente tutti gli slot disponibili.

### 2. Squadre

1. Vai su **Squadre**.
2. Aggiungi squadre **manualmente** (nome + genere M/F) oppure **importa CSV** (scarica il template con il pulsante apposito).
3. Per ogni squadra puoi impostare:
   - **Giorni preferiti** (soft constraint, peso configurabile)
   - **Fasce orarie preferite** (soft constraint)
   - **Slot indisponibili** (hard constraint â€“ il solver non assegnerÃ  mai queste partite in quegli slot)

### 3. Gironi

1. Vai su **Gironi**.
2. Clicca **Genera gironi** â†’ algoritmo greedy che massimizza la compatibilitÃ  di disponibilitÃ  tra squadre dello stesso girone.
3. Visualizza i gironi e la matrice di compatibilitÃ .
4. Il backend genera automaticamente i match round-robin per ogni girone.

### 4. Calendario (scheduling)

1. Vai su **Calendario**.
2. Clicca **Genera calendario** â†’ avvia il solver CP-SAT in background.
   - Il progresso Ã¨ trasmesso via WebSocket in tempo reale (obiettivo, soluzioni trovate).
3. Quando il solver termina, clicca **Applica soluzione** per salvare gli slot.
4. **Editing manuale:**
   - Trascina una partita da uno slot a un altro (drag & drop).
   - Usa **Lock/Unlock** per impedire che il prossimo solver ri-muova una partita.
5. Il **report qualitÃ ** mostra copertura %, partite non assegnate, partite bloccate, eventuali conflitti.

### 5. Risultati e classifiche

1. Vai su **Risultati**.
2. Seleziona il genere (M/F).
3. Inserisci gol e cartellini gialli per ogni partita, clicca **Salva**.
4. Le classifiche si aggiornano in tempo reale con tutti i tiebreaker configurati.
5. Inserisci i marcatori nella sezione dedicata (nome libero, senza necessitÃ  di un registro giocatori).

### 6. Bracket (finali)

1. Vai su **Bracket**.
2. Seleziona il genere, clicca **Genera bracket** â†’ cross-seeding automatico (1Â°A vs 2Â°B, 1Â°B vs 2Â°A).
3. Avanza i vincitori con **Avanza vincitore** â€“ il sistema propaga automaticamente il vincitore al turno successivo e il perdente alla finale 3Â° posto.

### 7. Export

1. Vai su **Export**.
2. **Scarica CSV** â†’ calendario completo con risultati (compatibile Excel/Fogli Google).
3. **Scarica PDF** â†’ PDF A4 con calendario, classifiche gironi e marcatori (generato server-side con WeasyPrint).
4. **Stampa pagina** â†’ stampa diretta dal browser.

---

## Architettura tecnica

```
.
â”œâ”€â”€ backend/                    # FastAPI + SQLite + OR-Tools
â”‚   â”œâ”€â”€ app/
â”‚   â”‚   â”œâ”€â”€ main.py             # FastAPI app, lifespan, middleware, router include
â”‚   â”‚   â”œâ”€â”€ database.py         # SQLAlchemy engine/session (SQLite)
â”‚   â”‚   â”œâ”€â”€ models/             # ORM: Tournament, Team, Group, Slot, Match, Result, GoalEvent
â”‚   â”‚   â”œâ”€â”€ schemas/            # Pydantic v2 schemas (input/output)
â”‚   â”‚   â”œâ”€â”€ routers/            # REST endpoints + WebSocket
â”‚   â”‚   â”‚   â”œâ”€â”€ tournaments.py  # CRUD torneo, giorni, slot
â”‚   â”‚   â”‚   â”œâ”€â”€ teams.py        # CRUD squadre, import CSV
â”‚   â”‚   â”‚   â”œâ”€â”€ groups.py       # Generazione gironi, compatibilitÃ 
â”‚   â”‚   â”‚   â”œâ”€â”€ schedule.py     # WebSocket solver, genera/applica/qualitÃ 
â”‚   â”‚   â”‚   â”œâ”€â”€ results.py      # Risultati + eventi gol
â”‚   â”‚   â”‚   â”œâ”€â”€ standings.py    # Classifiche + marcatori
â”‚   â”‚   â”‚   â”œâ”€â”€ bracket.py      # Bracket eliminazione diretta
â”‚   â”‚   â”‚   â””â”€â”€ export_router.py # CSV + PDF (WeasyPrint)
â”‚   â”‚   â”œâ”€â”€ services/           # Logica business
â”‚   â”‚   â”‚   â”œâ”€â”€ slot_generator.py    # Genera slot da finestre orarie
â”‚   â”‚   â”‚   â”œâ”€â”€ round_robin.py       # Accoppiamenti gironi
â”‚   â”‚   â”‚   â”œâ”€â”€ standings_calculator.py # Classifica con tiebreaker
â”‚   â”‚   â”‚   â”œâ”€â”€ group_builder.py     # Costruzione gironi greedy
â”‚   â”‚   â”‚   â”œâ”€â”€ bracket_generator.py # Bracket eliminazione diretta
â”‚   â”‚   â”‚   â””â”€â”€ scheduler.py         # Orchestrazione solver
â”‚   â”‚   â””â”€â”€ solver/             # OR-Tools CP-SAT
â”‚   â”‚       â”œâ”€â”€ cp_sat_solver.py     # TournamentScheduler (thread + callback)
â”‚   â”‚       â”œâ”€â”€ constraints.py       # Hard/soft constraint helpers
â”‚   â”‚       â””â”€â”€ penalty_system.py    # PenaltySystem con pesi configurabili
â”‚   â”œâ”€â”€ tests/                  # 27 pytest (unit + integration)
â”‚   â”œâ”€â”€ data/                   # Demo config JSON + CSV squadre
â”‚   â”œâ”€â”€ seed_demo.py            # Seeder via HTTP API
â”‚   â””â”€â”€ requirements.txt
â”‚
â”œâ”€â”€ frontend/                   # React 18 + TypeScript + Vite + Tailwind
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ api/client.ts       # Axios client per tutti gli endpoint
â”‚   â”‚   â”œâ”€â”€ store/tournament.ts # Zustand store (torneo corrente)
â”‚   â”‚   â”œâ”€â”€ types/index.ts      # TypeScript interfaces
â”‚   â”‚   â”œâ”€â”€ components/layout/  # Sidebar + AppLayout
â”‚   â”‚   â””â”€â”€ pages/              # 8 pagine React
â”‚   â”‚       â”œâ”€â”€ Dashboard.tsx       # KPI + top marcatori + prossime partite
â”‚   â”‚       â”œâ”€â”€ TournamentSetup.tsx # Wizard creazione torneo
â”‚   â”‚       â”œâ”€â”€ Teams.tsx           # Gestione squadre
â”‚   â”‚       â”œâ”€â”€ Groups.tsx          # Gironi + compatibilitÃ 
â”‚   â”‚       â”œâ”€â”€ Schedule.tsx        # Calendario drag&drop + WebSocket solver
â”‚   â”‚       â”œâ”€â”€ Results.tsx         # Risultati + classifiche + marcatori
â”‚   â”‚       â”œâ”€â”€ Bracket.tsx         # Bracket finali
â”‚   â”‚       â””â”€â”€ Export.tsx          # Export CSV/PDF/stampa
â”‚   â”œâ”€â”€ Dockerfile              # Multi-stage: build â†’ nginx
â”‚   â””â”€â”€ nginx.conf              # Proxy /api e /ws â†’ backend:8000
â”‚
â”œâ”€â”€ docker-compose.yml          # backend:8000 + frontend:3000 (nginx)
â””â”€â”€ README.md
```

### Solver CP-SAT

Il solver usa **OR-Tools CP-SAT** per assegnare ogni partita a uno slot:

- **Variabili:** `assigned[match_id, slot_id] âˆˆ {0, 1}`
- **Vincoli hard:**
  - Ogni partita assegnata a esattamente uno slot
  - Ogni slot contiene al massimo una partita
  - Slot di indisponibilitÃ  delle squadre non usabili
  - Partite giÃ  bloccate manualmente non ri-schedulate
- **Vincoli soft (penalitÃ  minimizzate):**
  - `pref_day_violation` â€“ partita non nel giorno preferito dalla squadra
  - `pref_window_violation` â€“ partita fuori fascia oraria preferita
  - `consecutive_penalty` â€“ squadra gioca in slot non consecutivi (se `prefers_consecutive`)
  - `equity_imbalance` â€“ distribuzione non equa dei giorni tra le squadre
  - `finals_day_preference` â€“ partita di fase finale non nel giorno finali (peso default 20)

### Stack tecnologico

| Layer | Tecnologia |
|---|---|
| Database | SQLite (file locale) |
| Solver | OR-Tools 9.11 (CP-SAT) |
| PDF | WeasyPrint 62 |
| Frontend | React 18, TypeScript, Vite 5, TailwindCSS 3 |
| State | Zustand 5, TanStack Query 5 |
| DnD | @dnd-kit/core + @dnd-kit/sortable |
| Deploy | Docker Compose (nginx + uvicorn) |

---

## Configurazione avanzata

### Pesi penalitÃ  solver

Dal wizard di configurazione (Step 4) o modificando direttamente il torneo:

| Chiave | Default | Descrizione |
|---|---|---|
| `pref_day` | 10 | PenalitÃ  per giorno non preferito |
| `pref_window` | 5 | PenalitÃ  per fascia non preferita |
| `consecutive` | 3 | PenalitÃ  per slot non consecutivi |
| `equity` | 8 | PenalitÃ  per squilibrio distribuzione giorni |
| `finals_day` | 20 | PenalitÃ  per finale non nel giorno finali |

### Ordine tiebreaker

Default: `head_to_head â†’ goal_diff â†’ goals_for â†’ goals_against â†’ fair_play â†’ draw`

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

La documentazione interattiva Swagger Ã¨ disponibile su `http://localhost:8000/docs`.

Principali endpoint:

```
GET  /api/tournaments                    Lista tornei
POST /api/tournaments                    Crea torneo
POST /api/tournaments/{id}/days          Aggiungi giorno (genera slot)
GET  /api/tournaments/{id}/slots         Lista slot disponibili

POST /api/tournaments/{id}/teams         Crea squadra
POST /api/tournaments/{id}/teams/import  Import CSV squadre

POST /api/tournaments/{id}/groups/generate  Genera gironi + round-robin
GET  /api/tournaments/{id}/groups/compatibility  Matrice compatibilitÃ 

WS   /api/tournaments/ws/{id}/solver     WebSocket progresso solver
POST /api/tournaments/{id}/schedule/generate  Avvia solver
POST /api/tournaments/{id}/schedule/apply     Applica soluzione
GET  /api/tournaments/{id}/schedule/quality   Report qualitÃ  calendario
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
