import csv
import io
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.slot import Day
from app.models.team import Team
from app.models.tournament import Tournament
from app.schemas.team import TeamCreate, TeamResponse, TeamUpdate

router = APIRouter(prefix="/api/tournaments/{tid}/teams", tags=["teams"])


def _get_tournament_or_404(tid: str, db: Session) -> Tournament:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")
    return tournament


def _check_team_limits(tournament: Tournament, db: Session, adding: int = 1) -> None:
    """Raise 400 if adding `adding` teams would exceed tournament.max_teams."""
    if tournament.max_teams is None:
        return
    current = db.query(Team).filter(Team.tournament_id == tournament.id).count()
    if current + adding > tournament.max_teams:
        raise HTTPException(
            400,
            f"Limite squadre raggiunto: il torneo ammette al massimo {tournament.max_teams} squadre "
            f"(attualmente {current}).",
        )


def _apply_tournament_gender(tournament: Tournament, data: dict) -> dict:
    """Override team gender with tournament gender when set."""
    if tournament.gender is not None:
        data["gender"] = tournament.gender.value if hasattr(tournament.gender, "value") else tournament.gender
    return data


def _norm(value: object) -> str:
    return str(value or "").strip().lower()


def _strip_finals_days_preferences(tid: str, preferred_days: list[str] | None, db: Session) -> list[str]:
    if not preferred_days:
        return []

    finals_days = db.query(Day).filter(Day.tournament_id == tid, Day.is_finals_day.is_(True)).all()
    finals_tokens = {_norm(day.id) for day in finals_days}
    finals_tokens.update({_norm(day.label) for day in finals_days})
    finals_tokens.update({_norm(day.date) for day in finals_days})

    return [day for day in preferred_days if _norm(day) not in finals_tokens]


@router.post("", response_model=TeamResponse)
def create_team(tid: str, data: TeamCreate, db: Session = Depends(get_db)) -> Team:
    tournament = _get_tournament_or_404(tid, db)
    _check_team_limits(tournament, db, adding=1)
    team_data = _apply_tournament_gender(tournament, data.model_dump())
    team_data["preferred_days"] = _strip_finals_days_preferences(tid, team_data.get("preferred_days"), db)
    team = Team(tournament_id=tid, **team_data)
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.get("", response_model=List[TeamResponse])
def list_teams(tid: str, db: Session = Depends(get_db)) -> List[Team]:
    return db.query(Team).filter(Team.tournament_id == tid).all()


@router.put("/{team_id}", response_model=TeamResponse)
def update_team(tid: str, team_id: str, data: TeamUpdate, db: Session = Depends(get_db)) -> Team:
    tournament = _get_tournament_or_404(tid, db)
    team = db.query(Team).filter(Team.id == team_id, Team.tournament_id == tid).first()
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    update_data = data.model_dump(exclude_none=True)
    update_data = _apply_tournament_gender(tournament, update_data)
    if "preferred_days" in update_data:
        update_data["preferred_days"] = _strip_finals_days_preferences(tid, update_data.get("preferred_days"), db)
    for key, value in update_data.items():
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
    tournament = _get_tournament_or_404(tid, db)
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))
    rows = list(reader)

    _check_team_limits(tournament, db, adding=len(rows))

    imported = []
    for i, row in enumerate(rows, start=1):
        # Fix #5: row["nome"] raises KeyError on malformed CSV; use .get() and validate.
        name = row.get("nome", "").strip()
        if not name:
            raise HTTPException(400, f"Riga {i}: campo 'nome' mancante o vuoto nel CSV")
        preferred_days = row.get("giorni_preferiti", "").split(";") if row.get("giorni_preferiti") else []
        preferred_days = _strip_finals_days_preferences(tid, preferred_days, db)
        team_data: dict = {
            "tournament_id": tid,
            "name": name,
            "gender": row.get("genere", "M"),
            "preferred_days": preferred_days,
        }
        team_data = _apply_tournament_gender(tournament, team_data)
        team = Team(**team_data)
        db.add(team)
        imported.append(name)

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
