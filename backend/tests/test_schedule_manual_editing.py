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


def test_patch_match_slot_returns_404_for_missing_match() -> None:
    res = client.patch("/api/matches/missing/slot", json={"slot_id": "x"})
    assert res.status_code == 404
    assert res.json()["detail"] == "Partita non trovata"


def test_patch_match_lock_returns_404_for_missing_match() -> None:
    res = client.patch("/api/matches/missing/lock", json={"locked": True})
    assert res.status_code == 404
    assert res.json()["detail"] == "Partita non trovata"


def _seed_scheduled_and_played_matches() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Manual Edit 2026", gender=Gender.M)
        db.add(tournament)
        db.flush()

        day = Day(
            tournament_id=tournament.id,
            date="2026-03-05",
            label="Giorno 1",
            is_finals_day=False,
            time_windows="[]",
        )
        db.add(day)
        db.flush()

        slot_a = Slot(day_id=day.id, start_time="10:00", end_time="10:30", is_occupied=True)
        slot_b = Slot(day_id=day.id, start_time="10:30", end_time="11:00", is_occupied=True)
        db.add_all([slot_a, slot_b])
        db.flush()

        team_home = Team(tournament_id=tournament.id, name="Home", gender=Gender.M)
        team_away = Team(tournament_id=tournament.id, name="Away", gender=Gender.M)
        db.add_all([team_home, team_away])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone M",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        scheduled = Match(
            group_id=group.id,
            team_home_id=team_home.id,
            team_away_id=team_away.id,
            slot_id=slot_a.id,
            status=MatchStatus.SCHEDULED,
        )
        played = Match(
            group_id=group.id,
            team_home_id=team_home.id,
            team_away_id=team_away.id,
            slot_id=slot_b.id,
            status=MatchStatus.PLAYED,
        )
        db.add_all([scheduled, played])
        db.commit()
        return {
            "tid": tournament.id,
            "scheduled_mid": scheduled.id,
            "played_mid": played.id,
            "scheduled_slot": slot_a.id,
            "played_slot": slot_b.id,
        }
    finally:
        db.close()


def test_unschedule_single_sets_match_pending_and_frees_slot() -> None:
    seeded = _seed_scheduled_and_played_matches()
    res = client.patch(f"/api/matches/{seeded['scheduled_mid']}/unschedule")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["match_id"] == seeded["scheduled_mid"]

    db = SessionLocal()
    try:
        match = db.query(Match).filter(Match.id == seeded["scheduled_mid"]).first()
        slot = db.query(Slot).filter(Slot.id == seeded["scheduled_slot"]).first()
        assert match is not None
        assert slot is not None
        assert match.slot_id is None
        assert str(match.status) == "MatchStatus.PENDING"
        assert slot.is_occupied is False
    finally:
        db.close()


def test_unschedule_single_rejects_played_match() -> None:
    seeded = _seed_scheduled_and_played_matches()
    res = client.patch(f"/api/matches/{seeded['played_mid']}/unschedule")
    assert res.status_code == 400
    assert "giocata" in res.json()["detail"].lower()


def test_patch_slot_rejects_played_match() -> None:
    seeded = _seed_scheduled_and_played_matches()
    res = client.patch(f"/api/matches/{seeded['played_mid']}/slot", json={"slot_id": seeded["scheduled_slot"]})
    assert res.status_code == 400
    assert "giocata" in res.json()["detail"].lower()


def test_patch_lock_rejects_played_match() -> None:
    seeded = _seed_scheduled_and_played_matches()
    res = client.patch(f"/api/matches/{seeded['played_mid']}/lock", json={"locked": True})
    assert res.status_code == 400
    assert "giocata" in res.json()["detail"].lower()


def test_unschedule_all_only_unschedules_non_played_matches() -> None:
    seeded = _seed_scheduled_and_played_matches()
    res = client.post(f"/api/tournaments/{seeded['tid']}/schedule/unschedule-all")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["unscheduled_matches"] >= 1
    assert body["skipped_played_matches"] >= 1

    db = SessionLocal()
    try:
        scheduled = db.query(Match).filter(Match.id == seeded["scheduled_mid"]).first()
        played = db.query(Match).filter(Match.id == seeded["played_mid"]).first()
        assert scheduled is not None
        assert played is not None
        assert scheduled.slot_id is None
        assert played.slot_id is not None
        assert str(played.status) == "MatchStatus.PLAYED"
    finally:
        db.close()
