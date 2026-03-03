import csv
import io
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.team import Team
from app.schemas.team import TeamCreate, TeamResponse, TeamUpdate

router = APIRouter(prefix="/api/tournaments/{tid}/teams", tags=["teams"])


@router.post("", response_model=TeamResponse)
def create_team(tid: str, data: TeamCreate, db: Session = Depends(get_db)) -> Team:
    team = Team(tournament_id=tid, **data.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.get("", response_model=List[TeamResponse])
def list_teams(tid: str, db: Session = Depends(get_db)) -> List[Team]:
    return db.query(Team).filter(Team.tournament_id == tid).all()


@router.put("/{team_id}", response_model=TeamResponse)
def update_team(tid: str, team_id: str, data: TeamUpdate, db: Session = Depends(get_db)) -> Team:
    team = db.query(Team).filter(Team.id == team_id, Team.tournament_id == tid).first()
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(team, key, value)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{team_id}")
def delete_team(tid: str, team_id: str, db: Session = Depends(get_db)) -> dict:
    team = db.query(Team).filter(Team.id == team_id, Team.tournament_id == tid).first()
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    db.delete(team)
    db.commit()
    return {"ok": True}


@router.post("/import")
async def import_teams(tid: str, file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))
    imported = []

    for row in reader:
        team = Team(
            tournament_id=tid,
            name=row["nome"],
            gender=row["genere"],
            preferred_days=row.get("giorni_preferiti", "").split(";") if row.get("giorni_preferiti") else [],
        )
        db.add(team)
        imported.append(row["nome"])

    db.commit()
    return {"imported": len(imported), "teams": imported}


@router.get("/csv-template")
def csv_template() -> PlainTextResponse:
    return PlainTextResponse(
        "nome,genere,giorni_preferiti,fasce_preferite,indisponibilita\n"
        "Team Alpha,M,1;2,10:00-13:00,\n"
        "Team Beta,F,,,Giorno 2\n",
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=template_squadre.csv"},
    )
