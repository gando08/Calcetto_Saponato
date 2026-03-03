from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def seed_tournament_with_teams() -> tuple[str, SessionLocal]:
    db = SessionLocal()
    tournament = Tournament(name="Test Torneo Gironi", teams_per_group=4)
    db.add(tournament)
    db.flush()

    for idx in range(4):
        db.add(
            Team(
                tournament_id=tournament.id,
                name=f"Team M{idx + 1}",
                gender=Gender.M,
                unavailable_slot_ids=[],
            )
        )
    for idx in range(4):
        db.add(
            Team(
                tournament_id=tournament.id,
                name=f"Team F{idx + 1}",
                gender=Gender.F,
                unavailable_slot_ids=[],
            )
        )

    db.commit()
    return tournament.id, db


def test_generate_groups_creates_groups_and_matches() -> None:
    tid, db = seed_tournament_with_teams()
    try:
        res = client.post(f"/api/tournaments/{tid}/groups/generate")
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["groups_created"] == 2
        assert body["matches_created"] == 12

        groups_res = client.get(f"/api/tournaments/{tid}/groups")
        assert groups_res.status_code == 200
        groups_payload = groups_res.json()
        assert len(groups_payload) == 2
        genders = {group["gender"] for group in groups_payload}
        assert genders == {"M", "F"}
        for group in groups_payload:
            assert len(group["teams"]) == 4
            assert len(group["matches"]) == 6
    finally:
        db.close()


def test_get_groups_compatibility_matrix() -> None:
    tid, db = seed_tournament_with_teams()
    try:
        res = client.get(f"/api/tournaments/{tid}/groups/compatibility")
        assert res.status_code == 200
        payload = res.json()
        assert "M" in payload
        assert "F" in payload
        assert "matrix" in payload["M"]
        assert "teams" in payload["M"]
        assert len(payload["M"]["teams"]) == 4
    finally:
        db.close()
