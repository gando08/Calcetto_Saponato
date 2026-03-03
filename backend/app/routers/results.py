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


class GoalCreate(BaseModel):
    player_name: str
    is_own_goal: bool = False
    attributed_to_team_id: str


@router.post("/{mid}/result")
def set_result(mid: str, data: ResultCreate, db: Session = Depends(get_db)) -> dict:
    match = db.query(Match).filter(Match.id == mid).first()
    if not match:
        raise HTTPException(404, "Partita non trovata")

    result = db.query(Result).filter(Result.match_id == mid).first()
    if result:
        result.goals_home = data.goals_home
        result.goals_away = data.goals_away
        result.yellow_home = data.yellow_home
        result.yellow_away = data.yellow_away
    else:
        result = Result(match_id=mid, **data.model_dump())
        db.add(result)

    match.status = MatchStatus.PLAYED
    db.commit()
    return {"ok": True}


@router.post("/{mid}/goals")
def add_goal(mid: str, data: GoalCreate, db: Session = Depends(get_db)) -> dict:
    goal = GoalEvent(
        match_id=mid,
        player_name_free=data.player_name,
        is_own_goal=data.is_own_goal,
        attributed_to_team_id=data.attributed_to_team_id,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return {"id": goal.id}


@router.delete("/goals/{gid}")
def delete_goal(gid: str, db: Session = Depends(get_db)) -> dict:
    goal = db.query(GoalEvent).filter(GoalEvent.id == gid).first()
    if not goal:
        raise HTTPException(404, "Gol non trovato")
    db.delete(goal)
    db.commit()
    return {"ok": True}
