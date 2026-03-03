from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal_event import GoalEvent
from app.models.group import Group, GroupPhase
from app.models.match import MatchStatus
from app.models.team import Team
from app.models.tournament import Tournament
from app.services.standings_calculator import calculate_standings

router = APIRouter(prefix="/api/tournaments", tags=["standings"])


@router.get("/{tid}/standings/{gender}")
def get_standings(tid: str, gender: str, db: Session = Depends(get_db)) -> list:
    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender.upper(),
            Group.phase == GroupPhase.GROUP,
        )
        .all()
    )

    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        return []

    config = {
        "points_win": tournament.points_win,
        "points_draw": tournament.points_draw,
        "points_loss": tournament.points_loss,
    }
    tiebreakers = tournament.tiebreaker_order or []

    result = []
    for group in groups:
        teams = [{"id": team.id, "name": team.name} for team in group.teams]
        matches_data = []

        for match in group.matches:
            if match.status == MatchStatus.PLAYED and match.result:
                matches_data.append(
                    {
                        "home": match.team_home_id,
                        "away": match.team_away_id,
                        "goals_home": match.result.goals_home,
                        "goals_away": match.result.goals_away,
                        "yellow_home": match.result.yellow_home,
                        "yellow_away": match.result.yellow_away,
                    }
                )

        standings = calculate_standings([team["id"] for team in teams], matches_data, config, tiebreakers)
        team_names = {team["id"]: team["name"] for team in teams}
        for row in standings:
            row["team_name"] = team_names.get(row["team"], row["team"])

        result.append({"group": group.name, "standings": standings})

    return result


@router.get("/{tid}/standings/scorers")
def get_scorers(tid: str, gender: str | None = None, db: Session = Depends(get_db)) -> list:
    del tid
    goals = db.query(GoalEvent).filter(GoalEvent.is_own_goal.is_(False)).all()
    scorers = {}
    for goal in goals:
        key = goal.player_name_free or (goal.player.name if goal.player else "Sconosciuto")
        team_id = goal.attributed_to_team_id
        pair = (key, team_id)
        scorers[pair] = scorers.get(pair, 0) + 1

    result = []
    for (name, team_id), goals_count in sorted(scorers.items(), key=lambda item: -item[1]):
        team = db.query(Team).filter(Team.id == team_id).first()
        if gender and team and team.gender != gender.upper():
            continue
        result.append(
            {
                "player": name,
                "team": team.name if team else "?",
                "team_gender": team.gender if team else "?",
                "goals": goals_count,
            }
        )
    return result
