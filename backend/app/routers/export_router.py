import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group
from app.models.match import Match

router = APIRouter(prefix="/api/tournaments", tags=["export"])


@router.get("/{tid}/export/csv")
def export_csv(tid: str, db: Session = Depends(get_db)) -> StreamingResponse:
    matches = db.query(Match).join(Group, Match.group_id == Group.id).filter(Group.tournament_id == tid).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Girone",
            "Genere",
            "Fase",
            "Squadra Casa",
            "Squadra Ospite",
            "Giorno",
            "Orario",
            "Stato",
            "Gol Casa",
            "Gol Ospite",
        ]
    )

    for match in matches:
        writer.writerow(
            [
                match.group.name if match.group else "",
                match.group.gender if match.group else "",
                match.phase,
                match.team_home.name if match.team_home else match.placeholder_home,
                match.team_away.name if match.team_away else match.placeholder_away,
                match.slot.day.label if match.slot and match.slot.day else "",
                match.slot.start_time if match.slot else "",
                match.status,
                match.result.goals_home if match.result else "",
                match.result.goals_away if match.result else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=calendario_{tid}.csv"},
    )
