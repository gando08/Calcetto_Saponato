import itertools

from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchPhase, MatchStatus
from app.models.result import Result
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def _seed_group_matches(db: SessionLocal, group: Group, teams: list[Team], *, played: bool) -> None:
    indexed_teams = list(enumerate(teams))
    for (home_idx, home_team), (away_idx, away_team) in itertools.combinations(indexed_teams, 2):
        match = Match(
            group_id=group.id,
            phase=MatchPhase.GROUP,
            round=1,
            team_home_id=home_team.id,
            team_away_id=away_team.id,
            placeholder_home=home_team.name,
            placeholder_away=away_team.name,
            status=MatchStatus.PLAYED if played else MatchStatus.PENDING,
        )
        db.add(match)
        db.flush()

        if played:
            home_wins = home_idx < away_idx
            db.add(
                Result(
                    match_id=match.id,
                    goals_home=3 if home_wins else 0,
                    goals_away=0 if home_wins else 3,
                    yellow_home=home_idx,
                    yellow_away=away_idx,
                )
            )


def seed_tournament_for_rules(
    *,
    gender: Gender,
    group_count: int,
    teams_per_group: int,
    played: bool,
) -> str:
    db = SessionLocal()
    try:
        tournament = Tournament(
            name=f"Test Bracket Rules {gender.value} {group_count}x{teams_per_group} played={played}",
            tiebreaker_order=["head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play", "draw"],
        )
        db.add(tournament)
        db.flush()

        for group_idx in range(group_count):
            teams: list[Team] = []
            for team_idx in range(teams_per_group):
                team = Team(
                    tournament_id=tournament.id,
                    name=f"{gender.value} Rule G{group_idx + 1} T{team_idx + 1}",
                    gender=gender,
                )
                db.add(team)
                teams.append(team)
            db.flush()

            group = Group(
                tournament_id=tournament.id,
                name=f"Girone {chr(65 + group_idx)}",
                gender=gender.value,
                phase=GroupPhase.GROUP,
            )
            group.teams = teams
            db.add(group)
            db.flush()

            _seed_group_matches(db, group, teams, played=played)

        db.commit()
        return tournament.id
    finally:
        db.close()


def _normalize_matches(matches: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for match in matches:
        normalized.append(
            {
                "phase": match["phase"],
                "round": match["round"],
                "team_home_id": match["team_home_id"],
                "team_away_id": match["team_away_id"],
                "placeholder_home": match["placeholder_home"],
                "placeholder_away": match["placeholder_away"],
                "bracket_position": match["bracket_position"],
                "has_prereq_home": bool(match["prerequisite_match_home_id"]),
                "has_prereq_away": bool(match["prerequisite_match_away_id"]),
            }
        )
    return normalized


def test_male_target_switches_to_sixteen_when_direct_qualifiers_exceed_eight() -> None:
    tid = seed_tournament_for_rules(gender=Gender.M, group_count=5, teams_per_group=4, played=True)

    response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert response.status_code == 200
    payload = response.json()

    assert payload["gender"] == "M"
    assert payload["target_size"] == 16
    assert payload["direct_count"] == 10
    assert payload["wildcard_count"] == 6
    assert isinstance(payload["warnings"], list)
    assert len(payload["matches"]) == 16
    assert sum(1 for match in payload["matches"] if match["phase"] == "third") == 1
    first_round_phases = {match["phase"] for match in payload["matches"] if match["round"] == 1}
    assert first_round_phases == {"round16"}


def test_female_generation_is_blocked_when_direct_qualifiers_exceed_four() -> None:
    tid = seed_tournament_for_rules(gender=Gender.F, group_count=3, teams_per_group=2, played=True)

    response = client.post(f"/api/tournaments/{tid}/bracket/F")
    assert response.status_code == 400
    assert "Female finals can have at most 4 direct qualifiers" in response.json()["detail"]


def test_generation_order_is_deterministic_across_regeneration() -> None:
    tid = seed_tournament_for_rules(gender=Gender.M, group_count=3, teams_per_group=4, played=True)

    first_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert first_response.status_code == 200
    first_payload = first_response.json()

    second_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert second_response.status_code == 200
    second_payload = second_response.json()

    assert first_payload["target_size"] == 8
    assert first_payload["direct_count"] == 6
    assert first_payload["wildcard_count"] == 2
    assert first_payload["warnings"] == second_payload["warnings"]
    assert _normalize_matches(first_payload["matches"]) == _normalize_matches(second_payload["matches"])
