from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group, GroupPhase
from app.services.bracket_generator import generate_bracket

router = APIRouter(prefix="/api/tournaments", tags=["bracket"])


@router.post("/{tid}/bracket/{gender}")
def generate_final_bracket(tid: str, gender: str, db: Session = Depends(get_db)) -> dict:
    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender.upper(),
            Group.phase == GroupPhase.GROUP,
        )
        .all()
    )

    advancing = []
    for group in groups:
        for idx, team in enumerate(group.teams[:2], start=1):
            advancing.append({"id": team.id, "name": team.name, "rank": idx, "group": group.name})

    wildcard_teams = []
    bracket = generate_bracket(advancing, wildcard_teams, [], gender.upper())
    return {"gender": gender.upper(), "matches": bracket}
