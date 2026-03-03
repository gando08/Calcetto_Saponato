from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def seed_tournament_for_bracket() -> str:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Torneo Bracket")
        db.add(tournament)
        db.flush()

        teams = []
        for idx in range(4):
            team = Team(
                tournament_id=tournament.id,
                name=f"Team B{idx + 1}",
                gender=Gender.M,
            )
            db.add(team)
            teams.append(team)
        db.flush()

        group_a = Group(
            tournament_id=tournament.id,
            name="Girone A",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        group_b = Group(
            tournament_id=tournament.id,
            name="Girone B",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        group_a.teams = teams[:2]
        group_b.teams = teams[2:]
        db.add_all([group_a, group_b])
        db.commit()

        return tournament.id
    finally:
        db.close()


def test_generate_and_get_bracket() -> None:
    tid = seed_tournament_for_bracket()

    generate_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert generate_response.status_code == 200
    generated = generate_response.json()
    assert generated["gender"] == "M"
    assert len(generated["matches"]) >= 3

    get_response = client.get(f"/api/tournaments/{tid}/bracket/M")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["gender"] == "M"
    assert len(fetched["matches"]) == len(generated["matches"])
    assert all("id" in match for match in fetched["matches"])


def test_advance_bracket_propagates_winner_to_next_match() -> None:
    tid = seed_tournament_for_bracket()
    generate_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert generate_response.status_code == 200

    bracket_response = client.get(f"/api/tournaments/{tid}/bracket/M")
    assert bracket_response.status_code == 200
    matches = bracket_response.json()["matches"]

    source_match = None
    downstream_match = None
    for candidate in matches:
        for possible_next in matches:
            if possible_next.get("prerequisite_match_home_id") == candidate["id"] or possible_next.get("prerequisite_match_away_id") == candidate["id"]:
                source_match = candidate
                downstream_match = possible_next
                break
        if source_match:
            break

    assert source_match is not None
    assert downstream_match is not None
    assert source_match.get("team_home_id")

    winner_id = source_match["team_home_id"]
    advance_response = client.post(
        f"/api/tournaments/{tid}/bracket/M/advance",
        json={"match_id": source_match["id"], "winner_team_id": winner_id},
    )
    assert advance_response.status_code == 200
    assert advance_response.json()["ok"] is True

    updated_matches = client.get(f"/api/tournaments/{tid}/bracket/M").json()["matches"]
    updated_downstream = next(match for match in updated_matches if match["id"] == downstream_match["id"])

    if updated_downstream.get("prerequisite_match_home_id") == source_match["id"]:
        assert updated_downstream["team_home_id"] == winner_id
    else:
        assert updated_downstream["team_away_id"] == winner_id
