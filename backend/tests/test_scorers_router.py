from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.goal_event import GoalEvent
from app.models.group import Group, GroupPhase
from app.models.match import Match
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def test_get_scorers_filters_by_tournament() -> None:
    db = SessionLocal()
    try:
        tournament_a = Tournament(name="Test Torneo A")
        tournament_b = Tournament(name="Test Torneo B")
        db.add_all([tournament_a, tournament_b])
        db.flush()

        team_a = Team(tournament_id=tournament_a.id, name="A-Team", gender=Gender.M)
        team_b = Team(tournament_id=tournament_b.id, name="B-Team", gender=Gender.M)
        db.add_all([team_a, team_b])
        db.flush()

        group_a = Group(
            tournament_id=tournament_a.id,
            name="Girone A",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        group_b = Group(
            tournament_id=tournament_b.id,
            name="Girone B",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add_all([group_a, group_b])
        db.flush()

        match_a = Match(group_id=group_a.id, placeholder_home="Casa A", placeholder_away="Ospite A")
        match_b = Match(group_id=group_b.id, placeholder_home="Casa B", placeholder_away="Ospite B")
        db.add_all([match_a, match_b])
        db.flush()

        goal_a = GoalEvent(
            match_id=match_a.id,
            player_name_free="Mario Rossi",
            attributed_to_team_id=team_a.id,
            is_own_goal=False,
        )
        goal_b = GoalEvent(
            match_id=match_b.id,
            player_name_free="Luca Verdi",
            attributed_to_team_id=team_b.id,
            is_own_goal=False,
        )
        db.add_all([goal_a, goal_b])
        db.commit()

        response = client.get(f"/api/tournaments/{tournament_a.id}/standings/scorers")
        assert response.status_code == 200
        payload = response.json()
        players = {row["player"] for row in payload}

        assert "Mario Rossi" in players
        assert "Luca Verdi" not in players
    finally:
        db.close()
