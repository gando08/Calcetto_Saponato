from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.match import Match
from app.models.slot import Day, Slot
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def _seed_quality_context() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Torneo Quality")
        db.add(tournament)
        db.flush()

        day1 = Day(
            tournament_id=tournament.id,
            date="2026-03-03",
            label="Giorno 1",
            is_finals_day=False,
            time_windows="[]",
        )
        day2 = Day(
            tournament_id=tournament.id,
            date="2026-03-04",
            label="Giorno 2",
            is_finals_day=False,
            time_windows="[]",
        )
        db.add_all([day1, day2])
        db.flush()

        slot1 = Slot(day_id=day1.id, start_time="10:00", end_time="10:30", is_occupied=True)
        slot2 = Slot(day_id=day2.id, start_time="15:00", end_time="15:30", is_occupied=True)
        db.add_all([slot1, slot2])
        db.flush()

        team_a = Team(
            tournament_id=tournament.id,
            name="Team A",
            gender=Gender.M,
            preferred_days=[day1.id],
            preferred_time_windows=[{"start": "09:00", "end": "12:00"}],
            unavailable_slot_ids=[],
        )
        team_b = Team(
            tournament_id=tournament.id,
            name="Team B",
            gender=Gender.M,
            preferred_days=[day1.id],
            preferred_time_windows=[{"start": "09:00", "end": "12:00"}],
            unavailable_slot_ids=[slot1.id],
        )
        db.add_all([team_a, team_b])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone QA",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        match_ok_hard = Match(
            group_id=group.id,
            team_home_id=team_a.id,
            team_away_id=team_b.id,
            slot_id=slot1.id,
        )
        match_soft = Match(
            group_id=group.id,
            team_home_id=team_a.id,
            team_away_id=team_b.id,
            slot_id=slot2.id,
        )
        db.add_all([match_ok_hard, match_soft])
        db.commit()

        return {
            "tournament_id": tournament.id,
            "slot1_id": slot1.id,
            "match_soft_id": match_soft.id,
        }
    finally:
        db.close()


def test_schedule_quality_reports_metrics_and_soft_alerts() -> None:
    seeded = _seed_quality_context()

    response = client.get(f"/api/tournaments/{seeded['tournament_id']}/schedule/quality")
    assert response.status_code == 200
    payload = response.json()

    assert payload["total_matches"] == 2
    assert payload["scheduled_matches"] == 2
    assert payload["total_slots"] == 2
    assert payload["slots_utilized"] == 2
    assert payload["hard_violations"] >= 1
    assert payload["soft_violations"] >= 2
    assert payload["preferences_respected_pct"] < 100
    assert 0 <= payload["equity_index"] <= 1

    alerts = payload["alerts"]
    assert isinstance(alerts, list)
    assert any(alert["match_id"] == seeded["match_soft_id"] for alert in alerts)


def test_schedule_quality_counts_slot_conflicts() -> None:
    seeded = _seed_quality_context()

    db = SessionLocal()
    try:
        matches = db.query(Match).join(Group, Match.group_id == Group.id).filter(Group.tournament_id == seeded["tournament_id"]).all()
        for match in matches:
            match.slot_id = seeded["slot1_id"]
        db.commit()
    finally:
        db.close()

    response = client.get(f"/api/tournaments/{seeded['tournament_id']}/schedule/quality")
    assert response.status_code == 200
    payload = response.json()
    assert payload["slot_conflicts"] >= 1
