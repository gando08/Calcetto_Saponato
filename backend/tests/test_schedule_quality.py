import json

from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchStatus
from app.models.slot import Day, Slot
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def _seed_tournament_with_slots_and_matches() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(
            name="Test Quality Torneo",
            match_duration_minutes=30,
            buffer_minutes=0,
        )
        db.add(tournament)
        db.flush()

        home = Team(tournament_id=tournament.id, name="Team QA1", gender=Gender.M)
        away = Team(tournament_id=tournament.id, name="Team QA2", gender=Gender.M)
        db.add_all([home, away])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone QA",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        day = Day(
            tournament_id=tournament.id,
            date="2026-06-01",
            label="Giorno 1",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "11:00"}]),
        )
        db.add(day)
        db.flush()

        slot1 = Slot(day_id=day.id, start_time="10:00", end_time="10:30")
        slot2 = Slot(day_id=day.id, start_time="10:30", end_time="11:00")
        db.add_all([slot1, slot2])
        db.flush()

        # One scheduled match, one unscheduled
        match_scheduled = Match(
            group_id=group.id,
            team_home_id=home.id,
            team_away_id=away.id,
            slot_id=slot1.id,
            status=MatchStatus.SCHEDULED,
        )
        match_unscheduled = Match(
            group_id=group.id,
            team_home_id=home.id,
            team_away_id=away.id,
        )
        match_locked = Match(
            group_id=group.id,
            team_home_id=home.id,
            team_away_id=away.id,
            slot_id=slot2.id,
            status=MatchStatus.SCHEDULED,
            is_manually_locked=True,
        )
        db.add_all([match_scheduled, match_unscheduled, match_locked])
        db.commit()

        return {"tournament_id": tournament.id}
    finally:
        db.close()


def test_schedule_quality_structure() -> None:
    seeded = _seed_tournament_with_slots_and_matches()
    tid = seeded["tournament_id"]

    response = client.get(f"/api/tournaments/{tid}/schedule/quality")
    assert response.status_code == 200

    data = response.json()
    assert "total_matches" in data
    assert "scheduled_matches" in data
    assert "unscheduled_matches" in data
    assert "coverage_pct" in data
    assert "locked_matches" in data
    assert "slot_conflicts" in data


def test_schedule_quality_values() -> None:
    seeded = _seed_tournament_with_slots_and_matches()
    tid = seeded["tournament_id"]

    response = client.get(f"/api/tournaments/{tid}/schedule/quality")
    assert response.status_code == 200
    data = response.json()

    # 3 matches total: 2 scheduled, 1 unscheduled, 1 locked
    assert data["total_matches"] == 3
    assert data["scheduled_matches"] == 2
    assert data["unscheduled_matches"] == 1
    assert data["locked_matches"] == 1
    assert data["slot_conflicts"] == 0
    assert data["coverage_pct"] == round(2 / 3 * 100, 1)


def test_schedule_quality_empty_tournament() -> None:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Empty Quality Torneo")
        db.add(tournament)
        db.commit()
        tid = tournament.id
    finally:
        db.close()

    response = client.get(f"/api/tournaments/{tid}/schedule/quality")
    assert response.status_code == 200
    data = response.json()
    assert data["total_matches"] == 0
    assert data["scheduled_matches"] == 0
    assert data["coverage_pct"] == 0.0
    assert data["slot_conflicts"] == 0


def test_schedule_quality_slot_conflicts() -> None:
    """Verify conflict detection: two matches assigned to the same slot."""
    db = SessionLocal()
    try:
        tournament = Tournament(name="Conflict Quality Torneo")
        db.add(tournament)
        db.flush()

        home = Team(tournament_id=tournament.id, name="Team C1", gender=Gender.M)
        away = Team(tournament_id=tournament.id, name="Team C2", gender=Gender.M)
        db.add_all([home, away])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone Conflict",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        day = Day(
            tournament_id=tournament.id,
            date="2026-06-02",
            label="Giorno 2",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "11:00"}]),
        )
        db.add(day)
        db.flush()

        slot = Slot(day_id=day.id, start_time="10:00", end_time="10:30")
        db.add(slot)
        db.flush()

        # Force two matches into the same slot (would not happen via normal API)
        match_a = Match(group_id=group.id, team_home_id=home.id, team_away_id=away.id, slot_id=slot.id)
        match_b = Match(group_id=group.id, team_home_id=home.id, team_away_id=away.id, slot_id=slot.id)
        db.add_all([match_a, match_b])
        db.commit()
        tid = tournament.id
    finally:
        db.close()

    response = client.get(f"/api/tournaments/{tid}/schedule/quality")
    assert response.status_code == 200
    data = response.json()
    assert data["slot_conflicts"] == 1
