from typing import List
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.match import Match, MatchStatus
from app.models.slot import Day, Slot
from app.models.tournament import Tournament
from app.schemas.tournament import DayCreate, TournamentCreate, TournamentResponse, TournamentUpdate
from app.services.slot_generator import generate_slots_for_day

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


class DaysReplacePayload(BaseModel):
    days: list[DayCreate]


def _serialize_day(day: Day) -> dict:
    windows = []
    try:
        windows = json.loads(day.time_windows or "[]")
    except Exception:
        windows = []
    return {
        "id": day.id,
        "date": day.date,
        "label": day.label,
        "is_finals_day": day.is_finals_day,
        "time_windows": windows,
        "slots_count": len(day.slots),
    }


def _create_day_with_slots(tid: str, tournament: Tournament, data: DayCreate, db: Session) -> tuple[Day, int]:
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

    return day, len(raw_slots)


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

    day, slots_generated = _create_day_with_slots(tid, tournament, data, db)

    db.commit()
    db.refresh(day)
    return {"id": day.id, "label": day.label, "slots_generated": slots_generated}


@router.get("/{tid}/days")
def get_days(tid: str, db: Session = Depends(get_db)) -> List[dict]:
    days = db.query(Day).filter(Day.tournament_id == tid).order_by(Day.date, Day.label).all()
    return [_serialize_day(day) for day in days]


@router.put("/{tid}/days")
def replace_days(tid: str, payload: DaysReplacePayload, db: Session = Depends(get_db)) -> dict:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    old_days = db.query(Day).filter(Day.tournament_id == tid).all()
    old_slot_ids = [slot.id for day in old_days for slot in day.slots]

    if old_slot_ids:
        matches = db.query(Match).filter(Match.slot_id.in_(old_slot_ids)).all()
        for match in matches:
            match.slot_id = None
            if match.status != MatchStatus.PLAYED:
                match.status = MatchStatus.PENDING
            match.is_manually_locked = False

    for old_day in old_days:
        db.delete(old_day)
    db.flush()

    slots_generated = 0
    for day_data in payload.days:
        _, generated = _create_day_with_slots(tid, tournament, day_data, db)
        slots_generated += generated

    db.commit()
    return {"ok": True, "days_replaced": len(payload.days), "slots_generated": slots_generated}


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
