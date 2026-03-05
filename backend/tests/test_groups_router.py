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


def seed_tournament_for_manual_groups() -> tuple[str, SessionLocal]:
    db = SessionLocal()
    tournament = Tournament(name="Test Manual Group Edit", teams_per_group=4)
    db.add(tournament)
    db.flush()

    for idx in range(8):
        db.add(
            Team(
                tournament_id=tournament.id,
                name=f"Team M{idx + 1}",
                gender=Gender.M,
                unavailable_slot_ids=[],
            )
        )

    db.commit()
    return tournament.id, db


def seed_tournament_with_five_female_teams() -> tuple[str, SessionLocal]:
    db = SessionLocal()
    tournament = Tournament(name="Test Female Balancing", teams_per_group=4)
    db.add(tournament)
    db.flush()

    for idx in range(5):
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


def test_generate_groups_avoids_single_team_female_group() -> None:
    tid, db = seed_tournament_with_five_female_teams()
    try:
        res = client.post(f"/api/tournaments/{tid}/groups/generate")
        assert res.status_code == 200

        groups_payload = client.get(f"/api/tournaments/{tid}/groups").json()
        female_groups = [group for group in groups_payload if group["gender"] == "F"]
        assert len(female_groups) == 2
        assert min(len(group["teams"]) for group in female_groups) >= 2
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


def test_update_group_teams_updates_group_and_matches() -> None:
    tid, db = seed_tournament_for_manual_groups()
    try:
        generate = client.post(f"/api/tournaments/{tid}/groups/generate")
        assert generate.status_code == 200

        groups = client.get(f"/api/tournaments/{tid}/groups").json()
        male_groups = [group for group in groups if group["gender"] == "M"]
        assert len(male_groups) == 2

        group_a = male_groups[0]
        group_b = male_groups[1]

        original_a_ids = [team["id"] for team in group_a["teams"]]
        original_b_ids = [team["id"] for team in group_b["teams"]]

        moved_from_b = original_b_ids[0]
        new_a_ids = [*original_a_ids[:-1], moved_from_b]

        update = client.put(
            f"/api/tournaments/{tid}/groups/{group_a['id']}/teams",
            json={"team_ids": new_a_ids},
        )
        assert update.status_code == 200, update.text
        updated_payload = update.json()
        assert updated_payload["ok"] is True
        assert set(updated_payload["teams"]) == set(new_a_ids)
        assert updated_payload["matches_created"] == 6

        groups_after = client.get(f"/api/tournaments/{tid}/groups").json()
        refreshed_a = next(group for group in groups_after if group["id"] == group_a["id"])
        refreshed_b = next(group for group in groups_after if group["id"] == group_b["id"])

        refreshed_a_ids = [team["id"] for team in refreshed_a["teams"]]
        refreshed_b_ids = [team["id"] for team in refreshed_b["teams"]]

        assert set(refreshed_a_ids) == set(new_a_ids)
        assert moved_from_b not in refreshed_b_ids
        assert len(refreshed_a["matches"]) == 6
    finally:
        db.close()


def test_update_group_teams_rejects_wrong_gender() -> None:
    tid, db = seed_tournament_with_teams()
    try:
        generate = client.post(f"/api/tournaments/{tid}/groups/generate")
        assert generate.status_code == 200

        groups = client.get(f"/api/tournaments/{tid}/groups").json()
        male_group = next(group for group in groups if group["gender"] == "M")
        female_group = next(group for group in groups if group["gender"] == "F")

        female_team_id = female_group["teams"][0]["id"]
        male_team_ids = [team["id"] for team in male_group["teams"]]
        payload = [*male_team_ids[:-1], female_team_id]

        update = client.put(
            f"/api/tournaments/{tid}/groups/{male_group['id']}/teams",
            json={"team_ids": payload},
        )
        assert update.status_code == 400
    finally:
        db.close()
