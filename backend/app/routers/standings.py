from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal_event import GoalEvent
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchStatus
from app.models.team import Team
from app.models.tournament import Tournament
from app.services.standings_calculator import calculate_standings

router = APIRouter(prefix="/api/tournaments", tags=["standings"])


def _normalize_player_name(name: str) -> str:
    """Normalize to Title Case, collapsing extra whitespace."""
    return " ".join(name.strip().split()).title()


# ── Scorers ranking ────────────────────────────────────────────────────────

@router.get("/{tid}/standings/scorers")
def get_scorers(tid: str, gender: str | None = None, db: Session = Depends(get_db)) -> list:
    goals = (
        db.query(GoalEvent)
        .join(Match, GoalEvent.match_id == Match.id)
        .join(Group, Match.group_id == Group.id)
        .filter(
            Group.tournament_id == tid,
            GoalEvent.is_own_goal.is_(False),
        )
        .all()
    )
    team_ids = {goal.attributed_to_team_id for goal in goals}
    teams = db.query(Team).filter(Team.id.in_(team_ids)).all() if team_ids else []
    teams_by_id = {team.id: team for team in teams}

    scorers: dict[tuple[str, str], int] = {}
    for goal in goals:
        raw_name = goal.player_name_free or (goal.player.name if goal.player else "Sconosciuto")
        # Always group case-insensitively: normalize for keying, keep Title Case display
        key = (_normalize_player_name(raw_name), goal.attributed_to_team_id)
        scorers[key] = scorers.get(key, 0) + 1

    result = []
    for (name, team_id), goals_count in sorted(scorers.items(), key=lambda item: -item[1]):
        team = teams_by_id.get(team_id)
        if gender and team and team.gender != gender.upper():
            continue
        result.append(
            {
                "player": name,
                "team": team.name if team else "?",
                "team_id": team_id,
                "team_gender": team.gender if team else "?",
                "goals": goals_count,
            }
        )
    return result


# ── Merge scorer aliases ───────────────────────────────────────────────────

class MergeScorersPayload(BaseModel):
    team_id: str
    canonical_name: str        # the name to keep
    aliases: list[str]         # names to replace (including canonical if present)


@router.post("/{tid}/standings/scorers/merge")
def merge_scorers(tid: str, payload: MergeScorersPayload, db: Session = Depends(get_db)) -> dict:
    """
    Rename all GoalEvent records for the given team whose player_name_free matches
    any of the provided aliases (case-insensitive) to canonical_name (Title Case).
    """
    canonical = _normalize_player_name(payload.canonical_name)
    if not canonical:
        raise HTTPException(400, "canonical_name non può essere vuoto")

    # Normalise aliases for case-insensitive comparison
    alias_set = {_normalize_player_name(a) for a in payload.aliases if a.strip()}
    if not alias_set:
        raise HTTPException(400, "Fornire almeno un alias da unificare")

    # All GoalEvents in this tournament for the team
    goals = (
        db.query(GoalEvent)
        .join(Match, GoalEvent.match_id == Match.id)
        .join(Group, Match.group_id == Group.id)
        .filter(
            Group.tournament_id == tid,
            GoalEvent.attributed_to_team_id == payload.team_id,
        )
        .all()
    )

    updated = 0
    for goal in goals:
        raw = goal.player_name_free or (goal.player.name if goal.player else "")
        if _normalize_player_name(raw) in alias_set:
            goal.player_name_free = canonical
            updated += 1

    db.commit()
    return {"ok": True, "updated": updated, "canonical_name": canonical}


# ── Group-phase standings ──────────────────────────────────────────────────

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
                        "red_home": match.result.red_home,
                        "red_away": match.result.red_away,
                        "delay_home": match.result.delay_home,
                        "delay_away": match.result.delay_away,
                    }
                )

        standings = calculate_standings([team["id"] for team in teams], matches_data, config, tiebreakers)
        team_names = {team["id"]: team["name"] for team in teams}
        for row in standings:
            row["team_name"] = team_names.get(row["team"], row["team"])

        result.append({"group": group.name, "standings": standings})

    return result
