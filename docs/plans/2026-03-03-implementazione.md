# Torneo Calcetto Saponato — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Applicazione web completa per organizzare tornei di calcetto saponato con scheduling ottimizzato CP-SAT, UI React interattiva, risultati live e classifica marcatori.

**Architecture:** FastAPI backend con SQLite (SQLAlchemy), solver OR-Tools CP-SAT in thread pool con progress via WebSocket, frontend React 18 + TypeScript con Vite e TailwindCSS. Due container Docker (backend + frontend).

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, OR-Tools, WeasyPrint, Pydantic v2 | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Zustand, React Query, DnD Kit, Recharts

**Design doc:** `docs/plans/2026-03-03-torneo-calcetto-saponato-design.md`

---

## FASE 1 — Scaffolding Progetto

---

### Task 1: Struttura directory backend

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/database.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/solver/__init__.py`
- Create: `backend/app/utils/__init__.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/requirements.txt`
- Create: `backend/Dockerfile`

**Step 1: Crea la struttura directory**
```bash
cd "C:/Users/egandolfi/OneDrive - Corob Spa/Desktop/Varie/FILE UTILI/TORNEO"
mkdir -p backend/app/models backend/app/schemas backend/app/routers backend/app/services backend/app/solver backend/app/utils backend/tests backend/data
touch backend/app/__init__.py backend/app/models/__init__.py backend/app/schemas/__init__.py
touch backend/app/routers/__init__.py backend/app/services/__init__.py backend/app/solver/__init__.py backend/app/utils/__init__.py
touch backend/tests/__init__.py
```

**Step 2: Scrivi `backend/requirements.txt`**
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
sqlalchemy==2.0.36
pydantic==2.9.0
pydantic-settings==2.6.0
ortools==9.11.4210
weasyprint==62.3
python-multipart==0.0.12
aiofiles==24.1.0
pandas==2.2.3
openpyxl==3.1.5
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

**Step 3: Scrivi `backend/app/database.py`**
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
import os

DB_PATH = os.getenv("DB_PATH", "data/tournament.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    from app.models import tournament, team, group, match, slot, result, goal_event
    Base.metadata.create_all(bind=engine)
```

**Step 4: Scrivi `backend/app/main.py`**
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db

app = FastAPI(title="Torneo Calcetto Saponato", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 5: Scrivi `backend/Dockerfile`**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libpango-1.0-0 libpangoft2-1.0-0 libpangocairo-1.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p data
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

**Step 6: Commit**
```bash
git add backend/
git commit -m "feat: scaffold backend structure"
```

---

### Task 2: Modelli SQLAlchemy

**Files:**
- Create: `backend/app/models/tournament.py`
- Create: `backend/app/models/team.py`
- Create: `backend/app/models/group.py`
- Create: `backend/app/models/slot.py`
- Create: `backend/app/models/match.py`
- Create: `backend/app/models/result.py`
- Create: `backend/app/models/goal_event.py`

**Step 1: `backend/app/models/tournament.py`**
```python
import uuid
from sqlalchemy import Column, String, Integer, Boolean, JSON, Enum as SAEnum
from sqlalchemy.orm import relationship
from app.database import Base
import enum

class TournamentStatus(str, enum.Enum):
    SETUP = "setup"
    GROUPS = "groups"
    SCHEDULED = "scheduled"
    ONGOING = "ongoing"
    FINISHED = "finished"

class Tournament(Base):
    __tablename__ = "tournaments"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    status = Column(SAEnum(TournamentStatus), default=TournamentStatus.SETUP)
    total_days = Column(Integer, default=4)
    match_duration_minutes = Column(Integer, default=30)
    buffer_minutes = Column(Integer, default=0)
    teams_per_group = Column(Integer, default=4)
    teams_advancing_per_group = Column(Integer, default=2)
    wildcard_enabled = Column(Boolean, default=False)
    wildcard_count = Column(Integer, default=0)
    points_win = Column(Integer, default=3)
    points_draw = Column(Integer, default=1)
    points_loss = Column(Integer, default=0)
    tiebreaker_order = Column(JSON, default=lambda: [
        "head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play", "draw"
    ])
    penalty_weights = Column(JSON, default=lambda: {
        "pref_day_violation": 10,
        "pref_window_violation": 8,
        "consecutive_penalty": 5,
        "rest_violation": 15,
        "equity_imbalance": 3,
        "finals_day_preference": 20
    })
    days = relationship("Day", back_populates="tournament", cascade="all, delete-orphan")
    teams = relationship("Team", back_populates="tournament", cascade="all, delete-orphan")
    groups = relationship("Group", back_populates="tournament", cascade="all, delete-orphan")
```

**Step 2: `backend/app/models/team.py`**
```python
import uuid
from sqlalchemy import Column, String, Boolean, JSON, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
import enum

class Gender(str, enum.Enum):
    M = "M"
    F = "F"

class Team(Base):
    __tablename__ = "teams"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    name = Column(String, nullable=False)
    gender = Column(SAEnum(Gender), nullable=False)
    preferred_days = Column(JSON, default=list)
    preferred_time_windows = Column(JSON, default=list)
    unavailable_slot_ids = Column(JSON, default=list)
    prefers_consecutive = Column(Boolean, default=False)
    tournament = relationship("Tournament", back_populates="teams")
    players = relationship("Player", back_populates="team", cascade="all, delete-orphan")
```

**Step 3: `backend/app/models/group.py`**
```python
import uuid
from sqlalchemy import Column, String, Enum as SAEnum, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.database import Base
import enum

class GroupPhase(str, enum.Enum):
    GROUP = "group"
    FINAL = "final"

group_teams = Table(
    "group_teams", Base.metadata,
    Column("group_id", String, ForeignKey("groups.id")),
    Column("team_id", String, ForeignKey("teams.id"))
)

class Group(Base):
    __tablename__ = "groups"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    name = Column(String, nullable=False)
    gender = Column(SAEnum("M", "F", name="gender_enum2"), nullable=False)
    phase = Column(SAEnum(GroupPhase), default=GroupPhase.GROUP)
    tournament = relationship("Tournament", back_populates="groups")
    teams = relationship("Team", secondary=group_teams)
    matches = relationship("Match", back_populates="group", cascade="all, delete-orphan")
```

**Step 4: `backend/app/models/slot.py`**
```python
import uuid
from sqlalchemy import Column, String, Boolean, Time, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Day(Base):
    __tablename__ = "days"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    date = Column(String, nullable=False)  # ISO date string
    label = Column(String, nullable=False)
    is_finals_day = Column(Boolean, default=False)
    time_windows = Column(String, nullable=False, default="[]")  # JSON string
    tournament = relationship("Tournament", back_populates="days")
    slots = relationship("Slot", back_populates="day", cascade="all, delete-orphan")

class Slot(Base):
    __tablename__ = "slots"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    day_id = Column(String, ForeignKey("days.id"), nullable=False)
    start_time = Column(String, nullable=False)  # "HH:MM"
    end_time = Column(String, nullable=False)    # "HH:MM"
    is_occupied = Column(Boolean, default=False)
    day = relationship("Day", back_populates="slots")
    match = relationship("Match", back_populates="slot", uselist=False)
```

**Step 5: `backend/app/models/match.py`**
```python
import uuid
from sqlalchemy import Column, String, Boolean, Integer, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
import enum

class MatchPhase(str, enum.Enum):
    GROUP = "group"
    QUARTER = "quarter"
    SEMI = "semi"
    THIRD = "third"
    FINAL = "final"

class MatchStatus(str, enum.Enum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    PLAYED = "played"

class Match(Base):
    __tablename__ = "matches"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    slot_id = Column(String, ForeignKey("slots.id"), nullable=True)
    team_home_id = Column(String, ForeignKey("teams.id"), nullable=True)
    team_away_id = Column(String, ForeignKey("teams.id"), nullable=True)
    placeholder_home = Column(String, nullable=True)
    placeholder_away = Column(String, nullable=True)
    phase = Column(SAEnum(MatchPhase), default=MatchPhase.GROUP)
    round = Column(Integer, default=0)
    status = Column(SAEnum(MatchStatus), default=MatchStatus.PENDING)
    is_manually_locked = Column(Boolean, default=False)
    prerequisite_match_home_id = Column(String, ForeignKey("matches.id"), nullable=True)
    prerequisite_match_away_id = Column(String, ForeignKey("matches.id"), nullable=True)
    group = relationship("Group", back_populates="matches")
    slot = relationship("Slot", back_populates="match")
    team_home = relationship("Team", foreign_keys=[team_home_id])
    team_away = relationship("Team", foreign_keys=[team_away_id])
    result = relationship("Result", back_populates="match", uselist=False, cascade="all, delete-orphan")
    goals = relationship("GoalEvent", back_populates="match", cascade="all, delete-orphan")
```

**Step 6: `backend/app/models/result.py` e `goal_event.py`**
```python
# result.py
import uuid
from sqlalchemy import Column, String, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Result(Base):
    __tablename__ = "results"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    match_id = Column(String, ForeignKey("matches.id"), unique=True, nullable=False)
    goals_home = Column(Integer, default=0)
    goals_away = Column(Integer, default=0)
    yellow_home = Column(Integer, default=0)
    yellow_away = Column(Integer, default=0)
    match = relationship("Match", back_populates="result")

# goal_event.py
import uuid
from sqlalchemy import Column, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Player(Base):
    __tablename__ = "players"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False)
    name = Column(String, nullable=False)
    team = relationship("Team", back_populates="players")

class GoalEvent(Base):
    __tablename__ = "goal_events"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    match_id = Column(String, ForeignKey("matches.id"), nullable=False)
    player_id = Column(String, ForeignKey("players.id"), nullable=True)
    player_name_free = Column(String, nullable=True)
    is_own_goal = Column(Boolean, default=False)
    attributed_to_team_id = Column(String, ForeignKey("teams.id"), nullable=False)
    match = relationship("Match", back_populates="goals")
    player = relationship("Player")
```

**Step 7: Aggiorna `backend/app/models/__init__.py`**
```python
from app.models.tournament import Tournament, TournamentStatus
from app.models.team import Team, Gender
from app.models.group import Group, GroupPhase
from app.models.slot import Day, Slot
from app.models.match import Match, MatchPhase, MatchStatus
from app.models.result import Result
from app.models.goal_event import Player, GoalEvent
```

**Step 8: Commit**
```bash
git add backend/app/models/
git commit -m "feat: add SQLAlchemy models"
```

---

## FASE 2 — Servizi Core con TDD

---

### Task 3: Slot Generation Service + Test

**Files:**
- Create: `backend/app/services/slot_generator.py`
- Create: `backend/tests/test_slot_generation.py`

**Step 1: Scrivi il test (failing)**
```python
# backend/tests/test_slot_generation.py
import pytest
from app.services.slot_generator import generate_slots_for_window, generate_slots_for_day

def test_single_window_no_buffer():
    slots = generate_slots_for_window("10:00", "12:00", duration=30, buffer=0)
    assert len(slots) == 4
    assert slots[0] == ("10:00", "10:30")
    assert slots[3] == ("11:30", "12:00")

def test_single_window_with_buffer():
    slots = generate_slots_for_window("10:00", "11:30", duration=30, buffer=5)
    # 10:00-10:30 + 5 buffer = next at 10:35, 10:35-11:05 + 5 = 11:10, 11:10-11:40 > 11:30 → stop
    assert len(slots) == 2
    assert slots[0] == ("10:00", "10:30")
    assert slots[1] == ("10:35", "11:05")

def test_window_too_short():
    slots = generate_slots_for_window("10:00", "10:20", duration=30, buffer=0)
    assert len(slots) == 0

def test_multiple_windows():
    windows = [{"start": "10:00", "end": "11:00"}, {"start": "15:00", "end": "16:00"}]
    slots = generate_slots_for_day(windows, duration=30, buffer=0)
    assert len(slots) == 4
    assert slots[0]["start_time"] == "10:00"
    assert slots[2]["start_time"] == "15:00"

def test_buffer_does_not_bleed_between_windows():
    windows = [{"start": "10:00", "end": "10:30"}, {"start": "11:00", "end": "11:30"}]
    slots = generate_slots_for_day(windows, duration=30, buffer=60)
    # Buffer non deve impedire lo slot nella seconda finestra
    assert len(slots) == 2
```

**Step 2: Verifica che il test fallisca**
```bash
cd backend && python -m pytest tests/test_slot_generation.py -v
# Expected: ImportError o 5 FAILED
```

**Step 3: Implementa `backend/app/services/slot_generator.py`**
```python
from datetime import datetime, timedelta
from typing import List, Tuple, Dict

def _to_minutes(time_str: str) -> int:
    h, m = map(int, time_str.split(":"))
    return h * 60 + m

def _to_time_str(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"

def generate_slots_for_window(
    start: str, end: str, duration: int, buffer: int
) -> List[Tuple[str, str]]:
    """Genera slot all'interno di una singola fascia oraria."""
    current = _to_minutes(start)
    end_min = _to_minutes(end)
    slots = []
    step = duration + buffer
    while current + duration <= end_min:
        slots.append((_to_time_str(current), _to_time_str(current + duration)))
        current += step
    return slots

def generate_slots_for_day(
    windows: List[Dict], duration: int, buffer: int
) -> List[Dict]:
    """Genera tutti gli slot per un giorno da una lista di time windows."""
    result = []
    for window in windows:
        raw = generate_slots_for_window(window["start"], window["end"], duration, buffer)
        for start, end in raw:
            result.append({"start_time": start, "end_time": end})
    return result
```

**Step 4: Esegui i test e verifica che passino**
```bash
python -m pytest tests/test_slot_generation.py -v
# Expected: 5 PASSED
```

**Step 5: Commit**
```bash
git add backend/app/services/slot_generator.py backend/tests/test_slot_generation.py
git commit -m "feat: add slot generation service with tests"
```

---

### Task 4: Round-Robin Service + Test

**Files:**
- Create: `backend/app/services/round_robin.py`
- Create: `backend/tests/test_round_robin.py`

**Step 1: Scrivi il test (failing)**
```python
# backend/tests/test_round_robin.py
import pytest
from app.services.round_robin import generate_round_robin

def test_4_teams_produces_6_matches():
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    assert len(matches) == 6

def test_no_team_plays_itself():
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    for home, away in matches:
        assert home != away

def test_no_duplicate_matches():
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    pairs = set()
    for home, away in matches:
        pair = frozenset([home, away])
        assert pair not in pairs
        pairs.add(pair)

def test_2_teams_produces_1_match():
    matches = generate_round_robin(["A", "B"])
    assert len(matches) == 1

def test_3_teams_produces_3_matches():
    matches = generate_round_robin(["A", "B", "C"])
    assert len(matches) == 3

def test_formula_n_choose_2():
    for n in range(2, 9):
        teams = [str(i) for i in range(n)]
        matches = generate_round_robin(teams)
        expected = n * (n - 1) // 2
        assert len(matches) == expected
```

**Step 2: Verifica che il test fallisca**
```bash
python -m pytest tests/test_round_robin.py -v
# Expected: ImportError
```

**Step 3: Implementa `backend/app/services/round_robin.py`**
```python
from itertools import combinations
from typing import List, Tuple, Any

def generate_round_robin(teams: List[Any]) -> List[Tuple[Any, Any]]:
    """
    Genera tutte le partite round-robin per una lista di squadre.
    Ogni coppia si affronta esattamente una volta.
    Returns: lista di tuple (home, away)
    """
    return list(combinations(teams, 2))
```

**Step 4: Esegui i test**
```bash
python -m pytest tests/test_round_robin.py -v
# Expected: 6 PASSED
```

**Step 5: Commit**
```bash
git add backend/app/services/round_robin.py backend/tests/test_round_robin.py
git commit -m "feat: add round-robin service with tests"
```

---

### Task 5: Standings Calculator + Test

**Files:**
- Create: `backend/app/services/standings_calculator.py`
- Create: `backend/tests/test_standings.py`

**Step 1: Scrivi i test**
```python
# backend/tests/test_standings.py
import pytest
from app.services.standings_calculator import calculate_standings, apply_tiebreakers

MATCHES = [
    {"home": "A", "away": "B", "goals_home": 3, "goals_away": 1, "yellow_home": 0, "yellow_away": 1},
    {"home": "A", "away": "C", "goals_home": 2, "goals_away": 2, "yellow_home": 0, "yellow_away": 0},
    {"home": "B", "away": "C", "goals_home": 0, "goals_away": 1, "yellow_home": 2, "yellow_away": 0},
]
CONFIG = {"points_win": 3, "points_draw": 1, "points_loss": 0}
TIEBREAKERS = ["head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play"]

def test_points_calculated_correctly():
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    points = {row["team"]: row["points"] for row in standings}
    assert points["A"] == 4  # 3 + 1
    assert points["B"] == 0  # 0 + 0
    assert points["C"] == 4  # 1 + 3

def test_standings_ordered_by_points():
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    assert standings[2]["team"] == "B"

def test_goal_diff_calculated():
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    row_a = next(r for r in standings if r["team"] == "A")
    assert row_a["goal_diff"] == 2  # (3-1) + (2-2) = 2

def test_all_fields_present():
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    required = {"team", "played", "won", "drawn", "lost", "goals_for", "goals_against", "goal_diff", "points", "yellow_cards"}
    assert required.issubset(set(standings[0].keys()))
```

**Step 2: Implementa `backend/app/services/standings_calculator.py`**
```python
from typing import List, Dict, Any

def calculate_standings(
    teams: List[str],
    matches: List[Dict],
    config: Dict,
    tiebreaker_order: List[str]
) -> List[Dict]:
    rows = {t: {"team": t, "played": 0, "won": 0, "drawn": 0, "lost": 0,
                "goals_for": 0, "goals_against": 0, "goal_diff": 0,
                "points": 0, "yellow_cards": 0} for t in teams}

    for m in matches:
        h, a = m["home"], m["away"]
        gh, ga = m["goals_home"], m["goals_away"]
        rows[h]["played"] += 1; rows[a]["played"] += 1
        rows[h]["goals_for"] += gh; rows[h]["goals_against"] += ga
        rows[a]["goals_for"] += ga; rows[a]["goals_against"] += gh
        rows[h]["yellow_cards"] += m.get("yellow_home", 0)
        rows[a]["yellow_cards"] += m.get("yellow_away", 0)
        if gh > ga:
            rows[h]["won"] += 1; rows[h]["points"] += config["points_win"]
            rows[a]["lost"] += 1; rows[a]["points"] += config["points_loss"]
        elif gh < ga:
            rows[a]["won"] += 1; rows[a]["points"] += config["points_win"]
            rows[h]["lost"] += 1; rows[h]["points"] += config["points_loss"]
        else:
            rows[h]["drawn"] += 1; rows[h]["points"] += config["points_draw"]
            rows[a]["drawn"] += 1; rows[a]["points"] += config["points_draw"]

    for r in rows.values():
        r["goal_diff"] = r["goals_for"] - r["goals_against"]

    return apply_tiebreakers(list(rows.values()), matches, tiebreaker_order, config)

def apply_tiebreakers(standings: List[Dict], matches: List[Dict], order: List[str], config: Dict) -> List[Dict]:
    def sort_key(row):
        keys = []
        for criterion in order:
            if criterion == "goal_diff": keys.append(-row["goal_diff"])
            elif criterion == "goals_for": keys.append(-row["goals_for"])
            elif criterion == "goals_against": keys.append(row["goals_against"])
            elif criterion == "fair_play": keys.append(row["yellow_cards"])
            else: keys.append(0)
        return [-row["points"]] + keys
    return sorted(standings, key=sort_key)
```

**Step 3: Esegui i test**
```bash
python -m pytest tests/test_standings.py -v
# Expected: 4 PASSED
```

**Step 4: Commit**
```bash
git add backend/app/services/standings_calculator.py backend/tests/test_standings.py
git commit -m "feat: add standings calculator with tiebreakers"
```

---

### Task 6: Group Builder Service

**Files:**
- Create: `backend/app/services/group_builder.py`

**Step 1: Implementa `backend/app/services/group_builder.py`**
```python
from typing import List, Dict, Any, Tuple
import math

def compute_overlap_score(team_a: Dict, team_b: Dict, all_slots: List[str]) -> float:
    """
    Calcola il punteggio di compatibilità oraria tra due squadre.
    Score = slot comuni disponibili / totale slot
    """
    unavail_a = set(team_a.get("unavailable_slot_ids", []))
    unavail_b = set(team_b.get("unavailable_slot_ids", []))
    available_a = set(all_slots) - unavail_a
    available_b = set(all_slots) - unavail_b
    if not all_slots:
        return 1.0
    overlap = len(available_a & available_b)
    return overlap / len(all_slots)

def build_groups(
    teams: List[Dict],
    teams_per_group: int,
    all_slot_ids: List[str]
) -> List[List[Dict]]:
    """
    Divide le squadre in gironi massimizzando la compatibilità oraria.
    Algoritmo greedy: assegna ogni squadra al girone con overlap medio più alto.
    """
    n_groups = math.ceil(len(teams) / teams_per_group)
    groups: List[List[Dict]] = [[] for _ in range(n_groups)]

    # Ordina le squadre per disponibilità (più restrittive prima)
    sorted_teams = sorted(teams, key=lambda t: len(t.get("unavailable_slot_ids", [])), reverse=True)

    for team in sorted_teams:
        best_group = 0
        best_score = -1.0
        for i, group in enumerate(groups):
            if len(group) >= teams_per_group:
                continue
            if not group:
                # Girone vuoto: score neutro
                score = 0.5
            else:
                scores = [compute_overlap_score(team, m, all_slot_ids) for m in group]
                score = sum(scores) / len(scores)
            if score > best_score:
                best_score = score
                best_group = i
        groups[best_group].append(team)

    return [g for g in groups if g]

def build_compatibility_matrix(teams: List[Dict], all_slot_ids: List[str]) -> Dict:
    """Genera matrice di compatibilità per visualizzazione UI."""
    matrix = {}
    for t in teams:
        matrix[t["id"]] = {}
        for other in teams:
            if t["id"] != other["id"]:
                matrix[t["id"]][other["id"]] = round(
                    compute_overlap_score(t, other, all_slot_ids) * 100, 1
                )
    return matrix
```

**Step 2: Commit**
```bash
git add backend/app/services/group_builder.py
git commit -m "feat: add group builder service"
```

---

### Task 7: Bracket Generator

**Files:**
- Create: `backend/app/services/bracket_generator.py`

**Step 1: Implementa `backend/app/services/bracket_generator.py`**
```python
from typing import List, Dict, Optional
import math

def generate_bracket(
    advancing_teams: List[Dict],
    wildcard_teams: List[Dict],
    groups: List[Dict],
    gender: str
) -> List[Dict]:
    """
    Genera il bracket a eliminazione diretta con seeding incrociato.
    Restituisce lista di match placeholder.
    """
    all_seeds = _seed_teams(advancing_teams, wildcard_teams, groups)
    n = len(all_seeds)
    bracket_size = _next_power_of_2(n)
    matches = []

    # Round 1 (quarti/ottavi etc.)
    round_matches = []
    for i in range(bracket_size // 2):
        home_idx = i
        away_idx = bracket_size - 1 - i
        home = all_seeds[home_idx] if home_idx < len(all_seeds) else None
        away = all_seeds[away_idx] if away_idx < len(all_seeds) else None
        match = {
            "phase": _phase_name(bracket_size),
            "round": 1,
            "gender": gender,
            "team_home_id": home["id"] if home else None,
            "team_away_id": away["id"] if away else None,
            "placeholder_home": home["name"] if home else f"Bye {home_idx+1}",
            "placeholder_away": away["name"] if away else f"Bye {away_idx+1}",
            "bracket_position": i
        }
        round_matches.append(match)
        matches.append(match)

    # Semifinali, finale, 3° posto
    current_round = round_matches
    round_num = 2
    while len(current_round) > 1:
        next_round = []
        for i in range(0, len(current_round), 2):
            match = {
                "phase": _phase_name(len(current_round) // 2),
                "round": round_num,
                "gender": gender,
                "team_home_id": None,
                "team_away_id": None,
                "placeholder_home": f"Vincitore Match {i+1}",
                "placeholder_away": f"Vincitore Match {i+2}",
                "bracket_position": i // 2,
                "prerequisite_positions": [i, i+1]
            }
            next_round.append(match)
            matches.append(match)
        current_round = next_round
        round_num += 1

    # Finale 3° posto
    matches.append({
        "phase": "third",
        "round": round_num - 1,
        "gender": gender,
        "team_home_id": None,
        "team_away_id": None,
        "placeholder_home": "Perdente Semifinale 1",
        "placeholder_away": "Perdente Semifinale 2",
        "bracket_position": 99
    })

    return matches

def _next_power_of_2(n: int) -> int:
    return 2 ** math.ceil(math.log2(max(n, 2)))

def _phase_name(size: int) -> str:
    return {1: "final", 2: "semi", 4: "quarter"}.get(size, "round")

def _seed_teams(advancing: List[Dict], wildcards: List[Dict], groups: List[Dict]) -> List[Dict]:
    """Seeding incrociato: 1°A, 1°B, 2°B, 2°A, ..."""
    seeded = []
    firsts = [t for t in advancing if t.get("rank") == 1]
    seconds = [t for t in advancing if t.get("rank") == 2]
    # Interleave firsts and reversed seconds per incrocio
    for i, first in enumerate(firsts):
        seeded.append(first)
    for second in reversed(seconds):
        seeded.append(second)
    seeded.extend(wildcards)
    return seeded
```

**Step 2: Commit**
```bash
git add backend/app/services/bracket_generator.py
git commit -m "feat: add bracket generator service"
```

---

## FASE 3 — Solver CP-SAT

---

### Task 8: Penalty System

**Files:**
- Create: `backend/app/solver/penalty_system.py`
- Create: `backend/tests/test_constraints.py`

**Step 1: Scrivi il test**
```python
# backend/tests/test_constraints.py
from app.solver.penalty_system import PenaltySystem

def test_no_violations_returns_zero():
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 0)
    assert ps.total() == 0

def test_single_violation():
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 3)
    assert ps.total() == 30

def test_multiple_violation_types():
    ps = PenaltySystem(weights={"pref_day_violation": 10, "consecutive_penalty": 5})
    ps.record("pref_day_violation", 2)
    ps.record("consecutive_penalty", 1)
    assert ps.total() == 25

def test_report_structure():
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 2)
    report = ps.report()
    assert report["pref_day_violation"]["count"] == 2
    assert report["pref_day_violation"]["penalty"] == 20
    assert report["total"] == 20
```

**Step 2: Implementa `backend/app/solver/penalty_system.py`**
```python
from typing import Dict
from dataclasses import dataclass, field

DEFAULT_WEIGHTS = {
    "pref_day_violation": 10,
    "pref_window_violation": 8,
    "consecutive_penalty": 5,
    "rest_violation": 15,
    "equity_imbalance": 3,
    "finals_day_preference": 20,
}

class PenaltySystem:
    def __init__(self, weights: Dict[str, int] = None):
        self.weights = {**DEFAULT_WEIGHTS, **(weights or {})}
        self._violations: Dict[str, int] = {k: 0 for k in self.weights}

    def record(self, violation_type: str, count: int = 1):
        if violation_type in self._violations:
            self._violations[violation_type] += count

    def total(self) -> int:
        return sum(self.weights.get(k, 0) * v for k, v in self._violations.items())

    def report(self) -> Dict:
        result = {}
        total = 0
        for k, count in self._violations.items():
            penalty = self.weights.get(k, 0) * count
            result[k] = {"count": count, "penalty": penalty}
            total += penalty
        result["total"] = total
        return result

    def reset(self):
        self._violations = {k: 0 for k in self.weights}
```

**Step 3: Esegui i test**
```bash
python -m pytest tests/test_constraints.py -v
# Expected: 4 PASSED
```

**Step 4: Commit**
```bash
git add backend/app/solver/penalty_system.py backend/tests/test_constraints.py
git commit -m "feat: add penalty system with tests"
```

---

### Task 9: CP-SAT Solver Core

**Files:**
- Create: `backend/app/solver/cp_sat_solver.py`
- Create: `backend/app/solver/constraints.py`

**Step 1: Implementa `backend/app/solver/constraints.py`**
```python
from typing import List, Dict, Set, Tuple

def check_hard_constraints(match: Dict, slot: Dict, teams_unavail: Dict[str, Set[str]]) -> bool:
    """Verifica se un match può essere assegnato a uno slot (hard constraints)."""
    slot_id = slot["id"]
    home_id = match.get("team_home_id")
    away_id = match.get("team_away_id")
    if home_id and slot_id in teams_unavail.get(home_id, set()):
        return False
    if away_id and slot_id in teams_unavail.get(away_id, set()):
        return False
    return True

def compute_soft_penalty(
    match: Dict, slot: Dict, slot_index: int, total_slots: int,
    team_schedules: Dict[str, List[int]],
    team_prefs: Dict[str, Dict],
    weights: Dict[str, int]
) -> int:
    """Calcola il penalty soft per l'assegnazione match→slot."""
    penalty = 0
    for team_id in [match.get("team_home_id"), match.get("team_away_id")]:
        if not team_id:
            continue
        prefs = team_prefs.get(team_id, {})
        # Preferenza giorno
        if prefs.get("preferred_days") and slot.get("day_id") not in prefs["preferred_days"]:
            penalty += weights.get("pref_day_violation", 10)
        # Preferenza fascia
        if prefs.get("preferred_time_windows"):
            in_window = any(
                w["start"] <= slot["start_time"] < w["end"]
                for w in prefs["preferred_time_windows"]
            )
            if not in_window:
                penalty += weights.get("pref_window_violation", 8)
        # Consecutività
        schedule = team_schedules.get(team_id, [])
        if schedule and not prefs.get("prefers_consecutive", False):
            if slot_index - 1 in schedule or slot_index + 1 in schedule:
                penalty += weights.get("consecutive_penalty", 5)
    # Equità: penalizza se sempre primo o ultimo slot del giorno
    position = slot_index / max(total_slots - 1, 1)
    if position == 0.0 or position == 1.0:
        penalty += weights.get("equity_imbalance", 3)
    return penalty
```

**Step 2: Implementa `backend/app/solver/cp_sat_solver.py`**
```python
from ortools.sat.python import cp_model
from typing import List, Dict, Any, Callable, Optional
import threading
from app.solver.constraints import check_hard_constraints, compute_soft_penalty
from app.solver.penalty_system import PenaltySystem

class SolverProgressCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self, on_progress: Callable[[Dict], None]):
        super().__init__()
        self._on_progress = on_progress
        self._solutions = 0

    def on_solution_callback(self):
        self._solutions += 1
        self._on_progress({
            "type": "solution",
            "solutions_found": self._solutions,
            "objective": self.ObjectiveValue(),
            "best_bound": self.BestObjectiveBound(),
        })

class TournamentScheduler:
    def __init__(self, config: Dict, on_progress: Optional[Callable] = None, max_time_seconds: int = 300):
        self.config = config
        self.on_progress = on_progress or (lambda x: None)
        self.max_time_seconds = max_time_seconds
        self._status = "idle"
        self._result = None
        self._thread = None

    def schedule_async(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]):
        """Avvia il solver in background thread."""
        self._thread = threading.Thread(
            target=self._run_solver, args=(matches, slots, teams), daemon=True
        )
        self._status = "running"
        self._thread.start()

    def _run_solver(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]):
        try:
            result = self.solve(matches, slots, teams)
            self._result = result
            self._status = "done"
            self.on_progress({"type": "done", "status": "optimal" if result else "infeasible"})
        except Exception as e:
            self._status = "error"
            self.on_progress({"type": "error", "message": str(e)})

    def solve(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]) -> Optional[Dict]:
        model = cp_model.CpModel()
        weights = self.config.get("penalty_weights", {})

        # Indici
        match_ids = [m["id"] for m in matches]
        slot_ids = [s["id"] for s in slots]
        m_idx = {m["id"]: i for i, m in enumerate(matches)}
        s_idx = {s["id"]: i for i, s in enumerate(slots)}

        # Indisponibilità
        teams_unavail = {t["id"]: set(t.get("unavailable_slot_ids", [])) for t in teams}
        team_prefs = {t["id"]: t for t in teams}

        # Variabili: assigned[m][s] ∈ {0,1}
        assigned = {}
        for m in matches:
            for s in slots:
                if not m.get("is_manually_locked"):
                    if check_hard_constraints(m, s, teams_unavail):
                        assigned[(m["id"], s["id"])] = model.new_bool_var(f"a_{m['id']}_{s['id']}")

        # Hard: ogni match assegnato a esattamente 1 slot
        for m in matches:
            if m.get("is_manually_locked") and m.get("slot_id"):
                continue
            valid_slots = [assigned[(m["id"], s["id"])] for s in slots if (m["id"], s["id"]) in assigned]
            if valid_slots:
                model.add_exactly_one(valid_slots)

        # Hard: ogni slot ha al massimo 1 match
        for s in slots:
            vars_in_slot = [assigned[(m["id"], s["id"])] for m in matches if (m["id"], s["id"]) in assigned]
            if vars_in_slot:
                model.add_at_most_one(vars_in_slot)

        # Soft: penalità
        penalty_terms = []
        for m in matches:
            for i, s in enumerate(slots):
                key = (m["id"], s["id"])
                if key not in assigned:
                    continue
                pen = compute_soft_penalty(m, s, i, len(slots), {}, team_prefs, weights)
                if pen > 0:
                    penalty_terms.append(assigned[key] * pen)

        if penalty_terms:
            model.minimize(sum(penalty_terms))

        # Solve
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.max_time_seconds
        solver.parameters.log_search_progress = False

        callback = SolverProgressCallback(self.on_progress)
        status = solver.solve(model, callback)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            assignment = {}
            for (match_id, slot_id), var in assigned.items():
                if solver.value(var):
                    assignment[match_id] = slot_id
            return {"assignment": assignment, "objective": solver.objective_value}

        return None

    @property
    def status(self):
        return self._status

    @property
    def result(self):
        return self._result
```

**Step 3: Commit**
```bash
git add backend/app/solver/
git commit -m "feat: add CP-SAT solver with soft/hard constraints"
```

---

## FASE 4 — API REST

---

### Task 10: Router Tournaments + Teams

**Files:**
- Create: `backend/app/schemas/tournament.py`
- Create: `backend/app/schemas/team.py`
- Create: `backend/app/routers/tournaments.py`
- Create: `backend/app/routers/teams.py`
- Modify: `backend/app/main.py`

**Step 1: `backend/app/schemas/tournament.py`**
```python
from pydantic import BaseModel
from typing import List, Dict, Optional
from enum import Enum

class TournamentCreate(BaseModel):
    name: str
    total_days: int = 4
    match_duration_minutes: int = 30
    buffer_minutes: int = 0
    teams_per_group: int = 4
    teams_advancing_per_group: int = 2
    wildcard_enabled: bool = False
    wildcard_count: int = 0
    points_win: int = 3
    points_draw: int = 1
    points_loss: int = 0
    tiebreaker_order: List[str] = ["head_to_head","goal_diff","goals_for","goals_against","fair_play","draw"]
    penalty_weights: Dict[str, int] = {}

class TournamentUpdate(TournamentCreate):
    name: Optional[str] = None

class DayCreate(BaseModel):
    date: str
    label: str
    is_finals_day: bool = False
    time_windows: List[Dict[str, str]]  # [{"start":"10:00","end":"13:00"}]

class TournamentResponse(TournamentCreate):
    id: str
    status: str
    class Config:
        from_attributes = True
```

**Step 2: `backend/app/schemas/team.py`**
```python
from pydantic import BaseModel
from typing import List, Dict, Optional

class TeamCreate(BaseModel):
    name: str
    gender: str  # "M" or "F"
    preferred_days: List[str] = []
    preferred_time_windows: List[Dict[str, str]] = []
    unavailable_slot_ids: List[str] = []
    prefers_consecutive: bool = False

class TeamUpdate(TeamCreate):
    name: Optional[str] = None
    gender: Optional[str] = None

class TeamResponse(TeamCreate):
    id: str
    tournament_id: str
    class Config:
        from_attributes = True
```

**Step 3: `backend/app/routers/tournaments.py`**
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from app.database import get_db
from app.models.tournament import Tournament
from app.models.slot import Day, Slot
from app.schemas.tournament import TournamentCreate, TournamentUpdate, TournamentResponse, DayCreate
from app.services.slot_generator import generate_slots_for_day

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

@router.post("", response_model=TournamentResponse)
def create_tournament(data: TournamentCreate, db: Session = Depends(get_db)):
    t = Tournament(**data.model_dump())
    db.add(t); db.commit(); db.refresh(t)
    return t

@router.get("", response_model=List[TournamentResponse])
def list_tournaments(db: Session = Depends(get_db)):
    return db.query(Tournament).all()

@router.get("/{tid}", response_model=TournamentResponse)
def get_tournament(tid: str, db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t: raise HTTPException(404, "Torneo non trovato")
    return t

@router.put("/{tid}", response_model=TournamentResponse)
def update_tournament(tid: str, data: TournamentUpdate, db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t: raise HTTPException(404)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit(); db.refresh(t); return t

@router.delete("/{tid}")
def delete_tournament(tid: str, db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t: raise HTTPException(404)
    db.delete(t); db.commit(); return {"ok": True}

@router.post("/{tid}/days")
def add_day(tid: str, data: DayCreate, db: Session = Depends(get_db)):
    t = db.query(Tournament).filter(Tournament.id == tid).first()
    if not t: raise HTTPException(404)
    day = Day(
        tournament_id=tid, date=data.date, label=data.label,
        is_finals_day=data.is_finals_day,
        time_windows=json.dumps([w for w in data.time_windows])
    )
    db.add(day); db.flush()
    # Genera slot automaticamente
    raw_slots = generate_slots_for_day(data.time_windows, t.match_duration_minutes, t.buffer_minutes)
    for s in raw_slots:
        db.add(Slot(day_id=day.id, start_time=s["start_time"], end_time=s["end_time"]))
    db.commit(); db.refresh(day)
    return {"id": day.id, "label": day.label, "slots_generated": len(raw_slots)}

@router.get("/{tid}/slots")
def get_slots(tid: str, db: Session = Depends(get_db)):
    days = db.query(Day).filter(Day.tournament_id == tid).all()
    result = []
    for day in days:
        for slot in day.slots:
            result.append({
                "id": slot.id, "day_id": day.id, "day_label": day.label,
                "start_time": slot.start_time, "end_time": slot.end_time,
                "is_occupied": slot.is_occupied, "is_finals_day": day.is_finals_day
            })
    return result
```

**Step 4: `backend/app/routers/teams.py`**
```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import csv, io
from app.database import get_db
from app.models.team import Team
from app.schemas.team import TeamCreate, TeamUpdate, TeamResponse

router = APIRouter(prefix="/api/tournaments/{tid}/teams", tags=["teams"])

@router.post("", response_model=TeamResponse)
def create_team(tid: str, data: TeamCreate, db: Session = Depends(get_db)):
    team = Team(tournament_id=tid, **data.model_dump())
    db.add(team); db.commit(); db.refresh(team); return team

@router.get("", response_model=List[TeamResponse])
def list_teams(tid: str, db: Session = Depends(get_db)):
    return db.query(Team).filter(Team.tournament_id == tid).all()

@router.put("/{team_id}", response_model=TeamResponse)
def update_team(tid: str, team_id: str, data: TeamUpdate, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id, Team.tournament_id == tid).first()
    if not team: raise HTTPException(404)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(team, k, v)
    db.commit(); db.refresh(team); return team

@router.delete("/{team_id}")
def delete_team(tid: str, team_id: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team: raise HTTPException(404)
    db.delete(team); db.commit(); return {"ok": True}

@router.post("/import")
async def import_teams(tid: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))
    imported = []
    for row in reader:
        team = Team(
            tournament_id=tid,
            name=row["nome"],
            gender=row["genere"],
            preferred_days=row.get("giorni_preferiti", "").split(";") if row.get("giorni_preferiti") else [],
        )
        db.add(team); imported.append(row["nome"])
    db.commit()
    return {"imported": len(imported), "teams": imported}

@router.get("/csv-template")
def csv_template():
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        "nome,genere,giorni_preferiti,fasce_preferite,indisponibilita\n"
        "Team Alpha,M,1;2,10:00-13:00,\n"
        "Team Beta,F,,,Giorno 2\n",
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=template_squadre.csv"}
    )
```

**Step 5: Aggiorna `backend/app/main.py`**
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.routers import tournaments, teams, schedule, results, standings, bracket, export_router

app = FastAPI(title="Torneo Calcetto Saponato", version="1.0.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def startup():
    init_db()

app.include_router(tournaments.router)
app.include_router(teams.router)

@app.get("/health")
def health():
    return {"status": "ok"}
```

**Step 6: Commit**
```bash
git add backend/app/schemas/ backend/app/routers/tournaments.py backend/app/routers/teams.py backend/app/main.py
git commit -m "feat: add tournament and teams REST API"
```

---

### Task 11: Router Schedule + WebSocket

**Files:**
- Create: `backend/app/routers/schedule.py`
- Create: `backend/app/services/scheduler.py`

**Step 1: `backend/app/services/scheduler.py`**
```python
from typing import Dict, Any, Optional, Callable
from sqlalchemy.orm import Session
from app.models.match import Match, MatchStatus
from app.models.slot import Slot
from app.models.team import Team
from app.models.tournament import Tournament
from app.solver.cp_sat_solver import TournamentScheduler
import json

# Dizionario globale per tenere traccia dei solver attivi
_active_solvers: Dict[str, TournamentScheduler] = {}

def get_solver_status(tournament_id: str) -> Dict:
    solver = _active_solvers.get(tournament_id)
    if not solver:
        return {"status": "idle"}
    return {"status": solver.status, "result": solver.result}

def start_scheduling(tournament_id: str, db: Session, on_progress: Callable):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    slots = db.query(Slot).join(Slot.day).filter_by(tournament_id=tournament_id).all()
    matches = db.query(Match).join(Match.group).filter_by(tournament_id=tournament_id).all()
    teams = db.query(Team).filter(Team.tournament_id == tournament_id).all()

    slot_dicts = [{"id": s.id, "day_id": s.day_id, "start_time": s.start_time,
                   "end_time": s.end_time, "is_finals_day": s.day.is_finals_day} for s in slots]
    match_dicts = [{"id": m.id, "team_home_id": m.team_home_id, "team_away_id": m.team_away_id,
                    "phase": m.phase, "slot_id": m.slot_id, "is_manually_locked": m.is_manually_locked} for m in matches]
    team_dicts = [{"id": t.id, "unavailable_slot_ids": t.unavailable_slot_ids or [],
                   "preferred_days": t.preferred_days or [], "preferred_time_windows": t.preferred_time_windows or [],
                   "prefers_consecutive": t.prefers_consecutive} for t in teams]

    config = {"penalty_weights": tournament.penalty_weights or {}}
    solver = TournamentScheduler(config=config, on_progress=on_progress)
    _active_solvers[tournament_id] = solver
    solver.schedule_async(match_dicts, slot_dicts, team_dicts)

def apply_solution(tournament_id: str, db: Session) -> bool:
    solver = _active_solvers.get(tournament_id)
    if not solver or solver.status != "done" or not solver.result:
        return False
    assignment = solver.result["assignment"]
    for match_id, slot_id in assignment.items():
        match = db.query(Match).filter(Match.id == match_id).first()
        if match:
            match.slot_id = slot_id
            match.status = MatchStatus.SCHEDULED
            slot = db.query(Slot).filter(Slot.id == slot_id).first()
            if slot:
                slot.is_occupied = True
    db.commit()
    return True
```

**Step 2: `backend/app/routers/schedule.py`**
```python
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.scheduler import start_scheduling, get_solver_status, apply_solution
import asyncio, json
from typing import Dict

router = APIRouter(prefix="/api/tournaments", tags=["schedule"])
_ws_clients: Dict[str, list] = {}

async def broadcast(tournament_id: str, data: dict):
    for ws in _ws_clients.get(tournament_id, []):
        try:
            await ws.send_json(data)
        except Exception:
            pass

@router.websocket("/ws/{tournament_id}/solver")
async def solver_ws(websocket: WebSocket, tournament_id: str):
    await websocket.accept()
    _ws_clients.setdefault(tournament_id, []).append(websocket)
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        _ws_clients[tournament_id].remove(websocket)

@router.post("/{tid}/schedule/generate")
async def generate_schedule(tid: str, db: Session = Depends(get_db)):
    def on_progress(data):
        import asyncio
        loop = asyncio.new_event_loop()
        loop.run_until_complete(broadcast(tid, data))
        loop.close()
    start_scheduling(tid, db, on_progress)
    return {"status": "started"}

@router.get("/{tid}/schedule/status")
def schedule_status(tid: str):
    return get_solver_status(tid)

@router.post("/{tid}/schedule/apply")
def apply_schedule(tid: str, db: Session = Depends(get_db)):
    success = apply_solution(tid, db)
    if not success:
        raise HTTPException(400, "Nessuna soluzione disponibile")
    return {"ok": True}

@router.get("/{tid}/schedule")
def get_schedule(tid: str, db: Session = Depends(get_db)):
    from app.models.match import Match
    from app.models.group import Group
    matches = db.query(Match).join(Match.group).filter(Group.tournament_id == tid).all()
    result = []
    for m in matches:
        result.append({
            "id": m.id, "phase": m.phase, "status": m.status,
            "team_home": m.team_home.name if m.team_home else m.placeholder_home,
            "team_away": m.team_away.name if m.team_away else m.placeholder_away,
            "slot": {"id": m.slot.id, "start_time": m.slot.start_time,
                     "end_time": m.slot.end_time, "day_label": m.slot.day.label} if m.slot else None,
            "group_name": m.group.name, "gender": m.group.gender,
            "is_manually_locked": m.is_manually_locked
        })
    return result
```

**Step 3: Commit**
```bash
git add backend/app/routers/schedule.py backend/app/services/scheduler.py
git commit -m "feat: add scheduling router with WebSocket progress"
```

---

### Task 12: Router Results, Standings, Scorers, Bracket, Export

**Files:**
- Create: `backend/app/routers/results.py`
- Create: `backend/app/routers/standings.py`
- Create: `backend/app/routers/bracket.py`
- Create: `backend/app/routers/export_router.py`

**Step 1: `backend/app/routers/results.py`**
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.match import Match, MatchStatus
from app.models.result import Result
from app.models.goal_event import GoalEvent

router = APIRouter(prefix="/api/matches", tags=["results"])

class ResultCreate(BaseModel):
    goals_home: int
    goals_away: int
    yellow_home: int = 0
    yellow_away: int = 0

class GoalCreate(BaseModel):
    player_name: str
    is_own_goal: bool = False
    attributed_to_team_id: str

@router.post("/{mid}/result")
def set_result(mid: str, data: ResultCreate, db: Session = Depends(get_db)):
    match = db.query(Match).filter(Match.id == mid).first()
    if not match: raise HTTPException(404)
    result = db.query(Result).filter(Result.match_id == mid).first()
    if result:
        result.goals_home = data.goals_home; result.goals_away = data.goals_away
        result.yellow_home = data.yellow_home; result.yellow_away = data.yellow_away
    else:
        result = Result(match_id=mid, **data.model_dump())
        db.add(result)
    match.status = MatchStatus.PLAYED
    db.commit()
    return {"ok": True}

@router.post("/{mid}/goals")
def add_goal(mid: str, data: GoalCreate, db: Session = Depends(get_db)):
    goal = GoalEvent(
        match_id=mid, player_name_free=data.player_name,
        is_own_goal=data.is_own_goal, attributed_to_team_id=data.attributed_to_team_id
    )
    db.add(goal); db.commit()
    return {"id": goal.id}

@router.delete("/goals/{gid}")
def delete_goal(gid: str, db: Session = Depends(get_db)):
    g = db.query(GoalEvent).filter(GoalEvent.id == gid).first()
    if not g: raise HTTPException(404)
    db.delete(g); db.commit(); return {"ok": True}
```

**Step 2: `backend/app/routers/standings.py`**
```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.group import Group
from app.models.match import Match, MatchStatus
from app.models.result import Result
from app.models.goal_event import GoalEvent
from app.services.standings_calculator import calculate_standings

router = APIRouter(prefix="/api/tournaments", tags=["standings"])

@router.get("/{tid}/standings/{gender}")
def get_standings(tid: str, gender: str, db: Session = Depends(get_db)):
    groups = db.query(Group).filter(Group.tournament_id == tid, Group.gender == gender.upper(), Group.phase == "group").all()
    result = []
    for group in groups:
        teams = [{"id": t.id, "name": t.name} for t in group.teams]
        matches_data = []
        for m in group.matches:
            if m.status == MatchStatus.PLAYED and m.result:
                matches_data.append({
                    "home": m.team_home_id, "away": m.team_away_id,
                    "goals_home": m.result.goals_home, "goals_away": m.result.goals_away,
                    "yellow_home": m.result.yellow_home, "yellow_away": m.result.yellow_away
                })
        from app.models.tournament import Tournament
        t = db.query(Tournament).filter(Tournament.id == tid).first()
        config = {"points_win": t.points_win, "points_draw": t.points_draw, "points_loss": t.points_loss}
        standings = calculate_standings([t["id"] for t in teams], matches_data, config, t.tiebreaker_order)
        # Aggiungi nome squadra
        team_names = {t["id"]: t["name"] for t in teams}
        for row in standings:
            row["team_name"] = team_names.get(row["team"], row["team"])
        result.append({"group": group.name, "standings": standings})
    return result

@router.get("/{tid}/standings/scorers")
def get_scorers(tid: str, gender: str = None, db: Session = Depends(get_db)):
    query = db.query(GoalEvent).filter(GoalEvent.is_own_goal == False)
    scorers = {}
    for goal in query.all():
        key = goal.player_name_free or (goal.player.name if goal.player else "Sconosciuto")
        team_id = goal.attributed_to_team_id
        k = (key, team_id)
        scorers[k] = scorers.get(k, 0) + 1
    from app.models.team import Team
    result = []
    for (name, team_id), goals in sorted(scorers.items(), key=lambda x: -x[1]):
        team = db.query(Team).filter(Team.id == team_id).first()
        if gender and team and team.gender != gender.upper():
            continue
        result.append({"player": name, "team": team.name if team else "?", "team_gender": team.gender if team else "?", "goals": goals})
    return result
```

**Step 3: `backend/app/routers/export_router.py`**
```python
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.orm import Session
from app.database import get_db
import csv, io

router = APIRouter(prefix="/api/tournaments", tags=["export"])

@router.get("/{tid}/export/csv")
def export_csv(tid: str, db: Session = Depends(get_db)):
    from app.models.match import Match
    from app.models.group import Group
    matches = db.query(Match).join(Match.group).filter(Group.tournament_id == tid).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Girone","Genere","Fase","Squadra Casa","Squadra Ospite","Giorno","Orario","Stato","Gol Casa","Gol Ospite"])
    for m in matches:
        writer.writerow([
            m.group.name, m.group.gender, m.phase,
            m.team_home.name if m.team_home else m.placeholder_home,
            m.team_away.name if m.team_away else m.placeholder_away,
            m.slot.day.label if m.slot else "",
            m.slot.start_time if m.slot else "",
            m.status,
            m.result.goals_home if m.result else "",
            m.result.goals_away if m.result else "",
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=calendario_{tid}.csv"})
```

**Step 4: Aggiorna `main.py` con tutti i router**
```python
from app.routers import tournaments, teams, schedule, results, standings, bracket, export_router
# app.include_router per ciascuno
```

**Step 5: Commit**
```bash
git add backend/app/routers/
git commit -m "feat: add results, standings, scorers, export routers"
```

---

## FASE 5 — Frontend React

---

### Task 13: Scaffolding Frontend

**Step 1: Crea il progetto Vite**
```bash
cd "C:/Users/egandolfi/OneDrive - Corob Spa/Desktop/Varie/FILE UTILI/TORNEO"
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install @tanstack/react-query axios zustand @dnd-kit/core @dnd-kit/sortable recharts
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Step 2: Installa shadcn/ui**
```bash
npx shadcn@latest init
# Scegli: TypeScript, Default style, slate base color, yes per CSS variables
npx shadcn@latest add button card badge tabs table dialog drawer sheet input label select slider toast progress
```

**Step 3: Configura `tailwind.config.js`**
```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

**Step 4: Crea struttura directory frontend**
```bash
mkdir -p src/components/layout src/components/schedule src/components/results src/components/scorers
mkdir -p src/pages src/hooks src/api src/store src/types
```

**Step 5: `frontend/src/types/index.ts`**
```typescript
export interface Tournament {
  id: string; name: string; status: string;
  total_days: number; match_duration_minutes: number; buffer_minutes: number;
  teams_per_group: number; teams_advancing_per_group: number;
  wildcard_enabled: boolean; wildcard_count: number;
  points_win: number; points_draw: number; points_loss: number;
  tiebreaker_order: string[]; penalty_weights: Record<string, number>;
}

export interface Team {
  id: string; tournament_id: string; name: string; gender: 'M' | 'F';
  preferred_days: string[]; preferred_time_windows: TimeWindow[];
  unavailable_slot_ids: string[]; prefers_consecutive: boolean;
}

export interface TimeWindow { start: string; end: string; }

export interface Slot {
  id: string; day_id: string; day_label: string;
  start_time: string; end_time: string;
  is_occupied: boolean; is_finals_day: boolean;
}

export interface Match {
  id: string; phase: string; status: string;
  team_home: string; team_away: string;
  slot: { id: string; start_time: string; end_time: string; day_label: string } | null;
  group_name: string; gender: string; is_manually_locked: boolean;
}

export interface StandingRow {
  team: string; team_name: string; played: number; won: number;
  drawn: number; lost: number; goals_for: number; goals_against: number;
  goal_diff: number; points: number; yellow_cards: number;
}

export interface Scorer { player: string; team: string; team_gender: string; goals: number; }
```

**Step 6: `frontend/src/api/client.ts`**
```typescript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

export const tournamentApi = {
  list: () => api.get('/api/tournaments').then(r => r.data),
  get: (id: string) => api.get(`/api/tournaments/${id}`).then(r => r.data),
  create: (data: any) => api.post('/api/tournaments', data).then(r => r.data),
  update: (id: string, data: any) => api.put(`/api/tournaments/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/tournaments/${id}`),
  addDay: (id: string, data: any) => api.post(`/api/tournaments/${id}/days`, data).then(r => r.data),
  getSlots: (id: string) => api.get(`/api/tournaments/${id}/slots`).then(r => r.data),
  generateSchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/generate`).then(r => r.data),
  getSchedule: (id: string) => api.get(`/api/tournaments/${id}/schedule`).then(r => r.data),
  getScheduleStatus: (id: string) => api.get(`/api/tournaments/${id}/schedule/status`).then(r => r.data),
  applySchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/apply`).then(r => r.data),
  getStandings: (id: string, gender: string) => api.get(`/api/tournaments/${id}/standings/${gender}`).then(r => r.data),
  getScorers: (id: string, gender?: string) => api.get(`/api/tournaments/${id}/standings/scorers`, { params: { gender } }).then(r => r.data),
  exportCsv: (id: string) => api.get(`/api/tournaments/${id}/export/csv`, { responseType: 'blob' }),
};

export const teamApi = {
  list: (tid: string) => api.get(`/api/tournaments/${tid}/teams`).then(r => r.data),
  create: (tid: string, data: any) => api.post(`/api/tournaments/${tid}/teams`, data).then(r => r.data),
  update: (tid: string, id: string, data: any) => api.put(`/api/tournaments/${tid}/teams/${id}`, data).then(r => r.data),
  delete: (tid: string, id: string) => api.delete(`/api/tournaments/${tid}/teams/${id}`),
  import: (tid: string, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post(`/api/tournaments/${tid}/teams/import`, fd).then(r => r.data);
  },
};

export const matchApi = {
  setResult: (mid: string, data: any) => api.post(`/api/matches/${mid}/result`, data).then(r => r.data),
  addGoal: (mid: string, data: any) => api.post(`/api/matches/${mid}/goals`, data).then(r => r.data),
  deleteGoal: (gid: string) => api.delete(`/api/goals/${gid}`),
};
```

**Step 7: `frontend/src/store/tournament.ts`**
```typescript
import { create } from 'zustand';
import type { Tournament } from '../types';

interface TournamentStore {
  current: Tournament | null;
  setCurrent: (t: Tournament | null) => void;
}

export const useTournamentStore = create<TournamentStore>((set) => ({
  current: null,
  setCurrent: (t) => set({ current: t }),
}));
```

**Step 8: `frontend/Dockerfile`**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Step 9: `frontend/nginx.conf`**
```nginx
server {
  listen 80;
  location / { root /usr/share/nginx/html; try_files $uri /index.html; }
  location /api { proxy_pass http://backend:8000; }
  location /ws { proxy_pass http://backend:8000; proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```

**Step 10: Commit**
```bash
git add frontend/
git commit -m "feat: scaffold React frontend with types, api client, store"
```

---

### Task 14: Layout + Navigazione

**Files:**
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/AppLayout.tsx`
- Create: `frontend/src/App.tsx`

**Step 1: `frontend/src/components/layout/Sidebar.tsx`**
```tsx
import { Link, useLocation } from 'react-router-dom';

const NAV = [
  { to: '/', label: '📊 Dashboard' },
  { to: '/setup', label: '⚙️ Configurazione' },
  { to: '/teams', label: '👥 Squadre' },
  { to: '/groups', label: '🏆 Gironi' },
  { to: '/schedule', label: '📅 Calendario' },
  { to: '/results', label: '📋 Risultati & Classifiche' },
  { to: '/bracket', label: '🏅 Bracket Finali' },
  { to: '/export', label: '📤 Export' },
];

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="w-56 bg-slate-900 text-white min-h-screen p-4 flex flex-col gap-1">
      <div className="text-xl font-bold mb-6 px-2">⚽ Calcetto Saponato</div>
      {NAV.map(({ to, label }) => (
        <Link key={to} to={to}
          className={`px-3 py-2 rounded-md text-sm transition-colors ${pathname === to ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
          {label}
        </Link>
      ))}
    </aside>
  );
}
```

**Step 2: `frontend/src/App.tsx`**
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { TournamentSetup } from './pages/TournamentSetup';
import { Teams } from './pages/Teams';
import { Groups } from './pages/Groups';
import { Schedule } from './pages/Schedule';
import { Results } from './pages/Results';
import { Bracket } from './pages/Bracket';
import { Export } from './pages/Export';

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="flex min-h-screen bg-slate-50">
          <Sidebar />
          <main className="flex-1 p-6 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/setup" element={<TournamentSetup />} />
              <Route path="/teams" element={<Teams />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/results" element={<Results />} />
              <Route path="/bracket" element={<Bracket />} />
              <Route path="/export" element={<Export />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

**Step 3: Installa react-router-dom**
```bash
cd frontend && npm install react-router-dom
```

**Step 4: Commit**
```bash
git add frontend/src/
git commit -m "feat: add sidebar navigation and app layout"
```

---

### Task 15: Pagine principali (Dashboard, Setup, Teams, Schedule, Results, Scorers, Bracket, Export)

> Ogni pagina è implementata come componente React funzionale con React Query per il fetching. Di seguito la struttura essenziale di ciascuna.

**`frontend/src/pages/Dashboard.tsx`** — KPI cards + alert violazioni + stato solver
**`frontend/src/pages/TournamentSetup.tsx`** — Stepper 4 step con form Zod validato
**`frontend/src/pages/Teams.tsx`** — Tabella + drawer preferenze + import CSV
**`frontend/src/pages/Groups.tsx`** — Drag & drop composizione + heatmap compatibilità
**`frontend/src/pages/Schedule.tsx`** — 3 viste (Giorno/Squadra/Girone) + drag & drop
**`frontend/src/pages/Results.tsx`** — Tabs gironi + inserimento risultati + marcatori
**`frontend/src/pages/Bracket.tsx`** — Visualizzazione bracket SVG + avanzamento
**`frontend/src/pages/Export.tsx`** — Selezione scope + bottoni CSV/PDF/Stampa

> Questi file vengono implementati per intero durante l'esecuzione del piano (ogni pagina è una commit separata).

**Step 1: Commit pagine placeholder (per compilazione)**
```bash
# Crea file placeholder per tutte le pagine
for page in Dashboard TournamentSetup Teams Groups Schedule Results Bracket Export; do
  echo "export function $page() { return <div className='p-4 text-xl'>$page — in costruzione</div>; }" > frontend/src/pages/$page.tsx
done
git add frontend/src/pages/
git commit -m "feat: add page placeholders for all routes"
```

---

## FASE 6 — Docker + Dati Demo

---

### Task 16: Docker Compose + Dati Demo

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/data/demo_config.json`
- Create: `backend/data/demo_teams.csv`
- Create: `backend/seed_demo.py`
- Create: `README.md`

**Step 1: `docker-compose.yml`**
```yaml
version: '3.9'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/data:/app/data
    environment:
      - DB_PATH=/app/data/tournament.db
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
```

**Step 2: `backend/data/demo_config.json`**
```json
{
  "name": "Torneo Estate 2026",
  "total_days": 4,
  "match_duration_minutes": 30,
  "buffer_minutes": 5,
  "teams_per_group": 4,
  "teams_advancing_per_group": 2,
  "wildcard_enabled": true,
  "wildcard_count": 2,
  "points_win": 3,
  "points_draw": 1,
  "points_loss": 0,
  "days": [
    {"label": "Giorno 1", "date": "2026-07-10", "is_finals_day": false,
     "time_windows": [{"start": "10:00", "end": "13:00"}, {"start": "15:00", "end": "19:00"}]},
    {"label": "Giorno 2", "date": "2026-07-11", "is_finals_day": false,
     "time_windows": [{"start": "10:00", "end": "13:00"}, {"start": "15:00", "end": "19:00"}]},
    {"label": "Giorno 3", "date": "2026-07-12", "is_finals_day": false,
     "time_windows": [{"start": "10:00", "end": "13:00"}, {"start": "15:00", "end": "19:00"}]},
    {"label": "Giorno 4", "date": "2026-07-13", "is_finals_day": true,
     "time_windows": [{"start": "10:00", "end": "18:00"}]}
  ]
}
```

**Step 3: `backend/data/demo_teams.csv`**
```csv
nome,genere,giorni_preferiti,fasce_preferite,indisponibilita
Team Alpha,M,1;2,10:00-13:00,
Team Beta,M,1;3,,
Team Gamma,M,2;3,15:00-19:00,
Team Delta,M,1;2,,
Team Epsilon,M,2;3,10:00-13:00,
Team Zeta,M,1,,
Team Eta,M,3;4,,
Team Theta,M,1;2,15:00-19:00,
Team Iota,M,2,,
Team Kappa,M,1;3,,
Team Lambda,M,2;4,,
Team Mu,M,1;2,,
Team Nu,M,3,,
Team Xi,M,1;4,,
Team Omicron,M,2;3,,
Team Pi,M,1,,
Tigri Rosa,F,1;2,10:00-13:00,
Leonesse,F,2;3,,
Aquile,F,1,,
Falchi,F,2;3,15:00-19:00,
Pantere,F,1;2,,
Stelle,F,3,,
```

**Step 4: `backend/seed_demo.py`**
```python
"""Script per caricare i dati demo nel DB."""
import json, csv, requests, sys

BASE = "http://localhost:8000"

with open("data/demo_config.json") as f:
    config = json.load(f)

days = config.pop("days")
resp = requests.post(f"{BASE}/api/tournaments", json=config)
tid = resp.json()["id"]
print(f"Torneo creato: {tid}")

for day in days:
    requests.post(f"{BASE}/api/tournaments/{tid}/days", json=day)
    print(f"  Giorno aggiunto: {day['label']}")

with open("data/demo_teams.csv") as f:
    requests.post(f"{BASE}/api/tournaments/{tid}/teams/import",
                  files={"file": ("demo_teams.csv", f, "text/csv")})
print("Squadre importate")
print(f"\nDemo pronto! Tournament ID: {tid}")
```

**Step 5: Commit**
```bash
git add docker-compose.yml backend/data/ backend/seed_demo.py
git commit -m "feat: add Docker Compose and demo dataset"
```

---

### Task 17: README

**Files:**
- Create: `README.md`

**Step 1: Scrivi `README.md`**
```markdown
# Torneo Calcetto Saponato

Applicazione web per organizzare tornei di calcetto saponato con scheduling ottimizzato.

## Avvio rapido

### Con Docker
```bash
docker-compose up --build
```
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Docs API: http://localhost:8000/docs

### Sviluppo locale

**Backend:**
```bash
cd backend
pip install -r requirements.txt
mkdir -p data
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Carica demo:**
```bash
cd backend && python seed_demo.py
```

## Test
```bash
cd backend && python -m pytest tests/ -v
```

## Struttura
- `/backend` — FastAPI + OR-Tools + SQLite
- `/frontend` — React 18 + TypeScript + Vite
- `/docs/plans` — Design doc e piano di implementazione
```

**Step 2: Commit**
```bash
git add README.md
git commit -m "docs: add README with setup instructions"
```

---

## CHECKLIST FINALE

- [ ] `python -m pytest backend/tests/ -v` → tutti i test passano
- [ ] `uvicorn app.main:app --reload` → API avviata su porta 8000
- [ ] `GET /health` → `{"status": "ok"}`
- [ ] `GET /docs` → Swagger UI accessibile
- [ ] `python seed_demo.py` → dati demo caricati
- [ ] `npm run dev` (frontend) → UI su porta 5173
- [ ] Tutte le pagine navigate senza errori console
- [ ] `docker-compose up --build` → entrambi i container avviati
- [ ] Solver genera calendario senza errori
- [ ] Export CSV funzionante

---

*Piano salvato: `docs/plans/2026-03-03-implementazione.md`*
*Esecuzione: usa `superpowers:executing-plans` o `superpowers:subagent-driven-development`*
```
