from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.match import Match
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def seed_match_for_results() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Torneo Results")
        db.add(tournament)
        db.flush()

        home = Team(tournament_id=tournament.id, name="Home Team", gender=Gender.M)
        away = Team(tournament_id=tournament.id, name="Away Team", gender=Gender.M)
        db.add_all([home, away])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone Test",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        match = Match(group_id=group.id, team_home_id=home.id, team_away_id=away.id)
        db.add(match)
        db.commit()
        return {"match_id": match.id, "home_id": home.id}
    finally:
        db.close()


def test_results_and_goals_lifecycle() -> None:
    seeded = seed_match_for_results()
    match_id = seeded["match_id"]
    home_id = seeded["home_id"]

    set_result = client.post(
        f"/api/matches/{match_id}/result",
        json={"goals_home": 2, "goals_away": 1, "yellow_home": 1, "yellow_away": 0},
    )
    assert set_result.status_code == 200
    assert set_result.json()["ok"] is True

    get_result = client.get(f"/api/matches/{match_id}/result")
    assert get_result.status_code == 200
    result_payload = get_result.json()
    assert result_payload["match_id"] == match_id
    assert result_payload["goals_home"] == 2
    assert result_payload["goals_away"] == 1

    add_goal = client.post(
        f"/api/matches/{match_id}/goals",
        json={"player_name": "Mario Rossi", "is_own_goal": False, "attributed_to_team_id": home_id},
    )
    assert add_goal.status_code == 200
    goal_id = add_goal.json()["id"]

    list_goals = client.get(f"/api/matches/{match_id}/goals")
    assert list_goals.status_code == 200
    goals_payload = list_goals.json()
    assert len(goals_payload) == 1
    assert goals_payload[0]["id"] == goal_id
    assert goals_payload[0]["player_name"] == "Mario Rossi"

    delete_goal = client.delete(f"/api/matches/goals/{goal_id}")
    assert delete_goal.status_code == 200
    assert delete_goal.json()["ok"] is True

    list_after_delete = client.get(f"/api/matches/{match_id}/goals")
    assert list_after_delete.status_code == 200
    assert list_after_delete.json() == []
