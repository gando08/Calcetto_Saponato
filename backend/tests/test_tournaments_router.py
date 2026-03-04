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


def _seed_tournament_with_scheduled_match() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Edit Tournament", match_duration_minutes=30, buffer_minutes=0)
        db.add(tournament)
        db.flush()

        day = Day(
            tournament_id=tournament.id,
            date="2026-08-01",
            label="Giorno 1",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "11:00"}]),
        )
        db.add(day)
        db.flush()

        slot = Slot(day_id=day.id, start_time="10:00", end_time="10:30", is_occupied=True)
        db.add(slot)
        db.flush()

        home = Team(tournament_id=tournament.id, name="Team Home", gender=Gender.M)
        away = Team(tournament_id=tournament.id, name="Team Away", gender=Gender.M)
        db.add_all([home, away])
        db.flush()

        group = Group(tournament_id=tournament.id, name="Girone A", gender="M", phase=GroupPhase.GROUP)
        db.add(group)
        db.flush()

        match = Match(
            group_id=group.id,
            team_home_id=home.id,
            team_away_id=away.id,
            slot_id=slot.id,
            status=MatchStatus.SCHEDULED,
        )
        db.add(match)
        db.commit()
        return {"tid": tournament.id, "match_id": match.id}
    finally:
        db.close()


def test_get_and_replace_days_updates_slots_and_unschedules_matches() -> None:
    seeded = _seed_tournament_with_scheduled_match()
    tid = seeded["tid"]
    mid = seeded["match_id"]

    get_days_before = client.get(f"/api/tournaments/{tid}/days")
    assert get_days_before.status_code == 200
    days_before = get_days_before.json()
    assert len(days_before) == 1
    assert days_before[0]["label"] == "Giorno 1"

    replace_days = client.put(
        f"/api/tournaments/{tid}/days",
        json={
            "days": [
                {
                    "date": "2026-08-02",
                    "label": "Giorno 2",
                    "is_finals_day": False,
                    "time_windows": [{"start": "09:00", "end": "10:00"}],
                },
                {
                    "date": "2026-08-03",
                    "label": "Giorno 3",
                    "is_finals_day": True,
                    "time_windows": [{"start": "14:00", "end": "15:00"}],
                },
            ]
        },
    )
    assert replace_days.status_code == 200, replace_days.text
    payload = replace_days.json()
    assert payload["days_replaced"] == 2
    assert payload["slots_generated"] == 4

    get_days_after = client.get(f"/api/tournaments/{tid}/days")
    assert get_days_after.status_code == 200
    days_after = get_days_after.json()
    labels = {day["label"] for day in days_after}
    assert labels == {"Giorno 2", "Giorno 3"}

    slots_after = client.get(f"/api/tournaments/{tid}/slots")
    assert slots_after.status_code == 200
    slot_labels = {slot["day_label"] for slot in slots_after.json()}
    assert slot_labels == {"Giorno 2", "Giorno 3"}

    schedule = client.get(f"/api/tournaments/{tid}/schedule")
    assert schedule.status_code == 200
    match = next(item for item in schedule.json() if item["id"] == mid)
    assert match["slot"] is None
    assert str(match["status"]).lower().endswith("pending")
