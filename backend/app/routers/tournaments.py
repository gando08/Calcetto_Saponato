from typing import List
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.slot import Day, Slot
from app.models.tournament import Tournament
from app.schemas.tournament import DayCreate, TournamentCreate, TournamentResponse, TournamentUpdate
from app.services.slot_generator import generate_slots_for_day

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


@router.post("", response_model=TournamentResponse)
def create_tournament(data: TournamentCreate, db: Session = Depends(get_db)) -> Tournament:
    tournament = Tournament(**data.model_dump())
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return tournament


@router.get("", response_model=List[TournamentResponse])
def list_tournaments(db: Session = Depends(get_db)) -> List[Tournament]:
    return db.query(Tournament).all()


@router.get("/{tid}", response_model=TournamentResponse)
def get_tournament(tid: str, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")
    return tournament


@router.put("/{tid}", response_model=TournamentResponse)
def update_tournament(tid: str, data: TournamentUpdate, db: Session = Depends(get_db)) -> Tournament:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(tournament, key, value)
    db.commit()
    db.refresh(tournament)
    return tournament


@router.delete("/{tid}")
def delete_tournament(tid: str, db: Session = Depends(get_db)) -> dict:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")
    db.delete(tournament)
    db.commit()
    return {"ok": True}


@router.post("/{tid}/days")
def add_day(tid: str, data: DayCreate, db: Session = Depends(get_db)) -> dict:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    day = Day(
        tournament_id=tid,
        date=data.date,
        label=data.label,
        is_finals_day=data.is_finals_day,
        time_windows=json.dumps([window for window in data.time_windows]),
    )
    db.add(day)
    db.flush()

    raw_slots = generate_slots_for_day(
        data.time_windows,
        tournament.match_duration_minutes,
        tournament.buffer_minutes,
    )
    for raw_slot in raw_slots:
        db.add(Slot(day_id=day.id, start_time=raw_slot["start_time"], end_time=raw_slot["end_time"]))

    db.commit()
    db.refresh(day)
    return {"id": day.id, "label": day.label, "slots_generated": len(raw_slots)}


@router.get("/{tid}/slots")
def get_slots(tid: str, db: Session = Depends(get_db)) -> List[dict]:
    days = db.query(Day).filter(Day.tournament_id == tid).all()
    result = []
    for day in days:
        for slot in day.slots:
            result.append(
                {
                    "id": slot.id,
                    "day_id": day.id,
                    "day_label": day.label,
                    "start_time": slot.start_time,
                    "end_time": slot.end_time,
                    "is_occupied": slot.is_occupied,
                    "is_finals_day": day.is_finals_day,
                }
            )
    return result
