from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal_event import GoalEvent
from app.models.match import Match, MatchStatus
from app.models.result import Result

router = APIRouter(prefix="/api/matches", tags=["results"])


class ResultCreate(BaseModel):
    goals_home: int
    goals_away: int
    yellow_home: int = 0
    yellow_away: int = 0
    red_home: int = 0
    red_away: int = 0
    delay_home: int = 0
    delay_away: int = 0


class GoalCreate(BaseModel):
    player_name: str
    is_own_goal: bool = False
    attributed_to_team_id: str


def _normalize_player_name(name: str) -> str:
    """Strip extra spaces and apply Title Case so 'mario rossi' == 'Mario Rossi'."""
    return " ".join(name.strip().split()).title()


def _get_match_or_404(mid: str, db: Session) -> Match:
    match = db.query(Match).filter(Match.id == mid).first()
    if not match:
        raise HTTPException(404, "Partita non trovata")
    return match


@router.post("/{mid}/result")
def set_result(mid: str, data: ResultCreate, db: Session = Depends(get_db)) -> dict:
    match = _get_match_or_404(mid, db)

    result = db.query(Result).filter(Result.match_id == mid).first()
    if result:
        result.goals_home = data.goals_home
        result.goals_away = data.goals_away
        result.yellow_home = data.yellow_home
        result.yellow_away = data.yellow_away
        result.red_home = data.red_home
        result.red_away = data.red_away
        result.delay_home = data.delay_home
        result.delay_away = data.delay_away
    else:
        result = Result(match_id=mid, **data.model_dump())
        db.add(result)

    match.status = MatchStatus.PLAYED
    db.commit()
    return {"ok": True}


@router.get("/{mid}/result")
def get_result(mid: str, db: Session = Depends(get_db)) -> dict:
    _get_match_or_404(mid, db)
    result = db.query(Result).filter(Result.match_id == mid).first()
    if not result:
        raise HTTPException(404, "Risultato non trovato")
    return {
        "match_id": mid,
        "goals_home": result.goals_home,
        "goals_away": result.goals_away,
        "yellow_home": result.yellow_home,
        "yellow_away": result.yellow_away,
        "red_home": result.red_home,
        "red_away": result.red_away,
        "delay_home": result.delay_home,
        "delay_away": result.delay_away,
    }


@router.post("/{mid}/goals")
def add_goal(mid: str, data: GoalCreate, db: Session = Depends(get_db)) -> dict:
    _get_match_or_404(mid, db)
    goal = GoalEvent(
        match_id=mid,
        player_name_free=_normalize_player_name(data.player_name),
        is_own_goal=data.is_own_goal,
        attributed_to_team_id=data.attributed_to_team_id,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return {"id": goal.id}


@router.get("/{mid}/goals")
def list_goals(mid: str, db: Session = Depends(get_db)) -> list[dict]:
    _get_match_or_404(mid, db)
    goals = db.query(GoalEvent).filter(GoalEvent.match_id == mid).order_by(GoalEvent.id).all()
    return [
        {
            "id": goal.id,
            "match_id": goal.match_id,
            "player_name": goal.player_name_free or (goal.player.name if goal.player else "Sconosciuto"),
            "is_own_goal": goal.is_own_goal,
            "attributed_to_team_id": goal.attributed_to_team_id,
        }
        for goal in goals
    ]


@router.delete("/goals/{gid}")
def delete_goal(gid: str, db: Session = Depends(get_db)) -> dict:
    goal = db.query(GoalEvent).filter(GoalEvent.id == gid).first()
    if not goal:
        raise HTTPException(404, "Gol non trovato")
    db.delete(goal)
    db.commit()
    return {"ok": True}
