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


def seed_tournament_for_bracket(
    *,
    gender: Gender = Gender.M,
    group_count: int = 4,
    teams_per_group: int = 2,
    played: bool = True,
) -> str:
    db = SessionLocal()
    try:
        tournament = Tournament(
            name=f"Test Bracket {gender.value} {group_count}x{teams_per_group} played={played}",
            tiebreaker_order=["head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play", "draw"],
        )
        db.add(tournament)
        db.flush()

        for group_idx in range(group_count):
            teams: list[Team] = []
            for team_idx in range(teams_per_group):
                team = Team(
                    tournament_id=tournament.id,
                    name=f"{gender.value} G{group_idx + 1} T{team_idx + 1}",
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


def test_generate_bracket_requires_group_phase_closed() -> None:
    tid = seed_tournament_for_bracket(group_count=2, teams_per_group=4, played=False)

    response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert response.status_code == 400
    assert "Group phase is not closed" in response.json()["detail"]


def test_generate_and_get_bracket_returns_metadata() -> None:
    tid = seed_tournament_for_bracket(group_count=4, teams_per_group=2, played=True)

    generate_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert generate_response.status_code == 200
    generated = generate_response.json()

    assert generated["gender"] == "M"
    assert generated["target_size"] == 8
    assert generated["direct_count"] == 8
    assert generated["wildcard_count"] == 0
    assert isinstance(generated["warnings"], list)
    assert isinstance(generated["matches"], list)
    assert len(generated["matches"]) == 8
    assert sum(1 for match in generated["matches"] if match["phase"] == "third") == 1

    previous_key = (-1, -1)
    for match in generated["matches"]:
        key = (match["round"], match["bracket_position"])
        assert key >= previous_key
        previous_key = key

    get_response = client.get(f"/api/tournaments/{tid}/bracket/M")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["gender"] == "M"
    assert fetched["matches"] == generated["matches"]


def test_advance_bracket_propagates_winner_to_next_match() -> None:
    tid = seed_tournament_for_bracket(group_count=4, teams_per_group=2, played=True)
    generate_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert generate_response.status_code == 200

    bracket_response = client.get(f"/api/tournaments/{tid}/bracket/M")
    assert bracket_response.status_code == 200
    matches = bracket_response.json()["matches"]

    source_match = None
    downstream_match = None
    for candidate in matches:
        if not candidate.get("team_home_id") or not candidate.get("team_away_id"):
            continue
        for possible_next in matches:
            if possible_next.get("prerequisite_match_home_id") == candidate["id"] or possible_next.get("prerequisite_match_away_id") == candidate["id"]:
                source_match = candidate
                downstream_match = possible_next
                break
        if source_match:
            break

    assert source_match is not None
    assert downstream_match is not None

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


def test_advance_keeps_bracket_positions_stable() -> None:
    tid = seed_tournament_for_bracket(group_count=4, teams_per_group=2, played=True)
    generate_response = client.post(f"/api/tournaments/{tid}/bracket/M")
    assert generate_response.status_code == 200

    initial_matches = client.get(f"/api/tournaments/{tid}/bracket/M").json()["matches"]
    initial_positions = {match["id"]: (match["round"], match["bracket_position"]) for match in initial_matches}

    source_match = None
    for candidate in initial_matches:
        if not candidate.get("team_home_id") or not candidate.get("team_away_id"):
            continue
        has_downstream = any(
            possible_next.get("prerequisite_match_home_id") == candidate["id"]
            or possible_next.get("prerequisite_match_away_id") == candidate["id"]
            for possible_next in initial_matches
        )
        if has_downstream:
            source_match = candidate
            break

    assert source_match is not None
    winner_id = source_match["team_home_id"]
    advance_response = client.post(
        f"/api/tournaments/{tid}/bracket/M/advance",
        json={"match_id": source_match["id"], "winner_team_id": winner_id},
    )
    assert advance_response.status_code == 200

    updated_matches = client.get(f"/api/tournaments/{tid}/bracket/M").json()["matches"]
    updated_positions = {match["id"]: (match["round"], match["bracket_position"]) for match in updated_matches}

    assert updated_positions == initial_positions
