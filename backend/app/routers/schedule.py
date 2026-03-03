import asyncio
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group
from app.models.match import Match, MatchStatus
from app.models.slot import Slot
from app.services.scheduler import apply_solution, get_solver_status, start_scheduling

router = APIRouter(prefix="/api/tournaments", tags=["schedule"])
manual_router = APIRouter(prefix="/api/matches", tags=["schedule"])
_ws_clients: Dict[str, List[WebSocket]] = {}


async def broadcast(tournament_id: str, data: dict) -> None:
    for ws in _ws_clients.get(tournament_id, []):
        try:
            await ws.send_json(data)
        except Exception:
            pass


@router.websocket("/ws/{tournament_id}/solver")
async def solver_ws(websocket: WebSocket, tournament_id: str) -> None:
    await websocket.accept()
    _ws_clients.setdefault(tournament_id, []).append(websocket)
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        _ws_clients[tournament_id].remove(websocket)


class GenerateBody(BaseModel):
    companion_tournament_ids: Optional[List[str]] = None


@router.post("/{tid}/schedule/generate")
async def generate_schedule(
    tid: str,
    body: GenerateBody = Body(default_factory=GenerateBody),
    db: Session = Depends(get_db),
) -> dict:
    loop = asyncio.get_event_loop()
    all_tids = [tid] + (body.companion_tournament_ids or [])

    def on_progress(data: dict) -> None:
        for broadcast_tid in all_tids:
            asyncio.run_coroutine_threadsafe(broadcast(broadcast_tid, data), loop)

    start_scheduling(tid, db, on_progress, companion_tids=body.companion_tournament_ids)
    return {"status": "started"}


@router.get("/{tid}/schedule/status")
def schedule_status(tid: str) -> dict:
    return get_solver_status(tid)


@router.get("/{tid}/schedule/quality")
def schedule_quality(tid: str, db: Session = Depends(get_db)) -> dict:
    matches = (
        db.query(Match)
        .join(Group, Match.group_id == Group.id)
        .filter(Group.tournament_id == tid)
        .all()
    )

    total = len(matches)
    scheduled = sum(1 for m in matches if m.slot_id is not None)
    locked = sum(1 for m in matches if m.is_manually_locked)
    slot_ids = [m.slot_id for m in matches if m.slot_id]
    conflicts = max(0, len(slot_ids) - len(set(slot_ids)))

    return {
        "total_matches": total,
        "scheduled_matches": scheduled,
        "unscheduled_matches": total - scheduled,
        "coverage_pct": round(scheduled / total * 100, 1) if total > 0 else 0.0,
        "locked_matches": locked,
        "slot_conflicts": conflicts,
    }


@router.post("/{tid}/schedule/apply")
def apply_schedule(tid: str, db: Session = Depends(get_db)) -> dict:
    success = apply_solution(tid, db)
    if not success:
        raise HTTPException(400, "Nessuna soluzione disponibile")
    return {"ok": True}


@router.get("/{tid}/schedule")
def get_schedule(tid: str, db: Session = Depends(get_db)) -> List[dict]:
    matches = db.query(Match).join(Group, Match.group_id == Group.id).filter(Group.tournament_id == tid).all()
    result = []
    for match in matches:
        result.append(
            {
                "id": match.id,
                "phase": str(match.phase),
                "status": str(match.status),
                "team_home_id": match.team_home_id,
                "team_away_id": match.team_away_id,
                "team_home": match.team_home.name if match.team_home else match.placeholder_home,
                "team_away": match.team_away.name if match.team_away else match.placeholder_away,
                "result": {
                    "goals_home": match.result.goals_home,
                    "goals_away": match.result.goals_away,
                    "yellow_home": match.result.yellow_home,
                    "yellow_away": match.result.yellow_away,
                }
                if match.result
                else None,
                "slot": {
                    "id": match.slot.id,
                    "start_time": match.slot.start_time,
                    "end_time": match.slot.end_time,
                    "day_label": match.slot.day.label if match.slot.day else "",
                }
                if match.slot
                else None,
                "group_name": match.group.name if match.group else "",
                "gender": match.group.gender if match.group else "",
                "is_manually_locked": match.is_manually_locked,
            }
        )
    return result


class MatchSlotPatch(BaseModel):
    slot_id: str


class MatchLockPatch(BaseModel):
    locked: bool


@manual_router.patch("/{mid}/slot")
def reassign_match_slot(mid: str, payload: MatchSlotPatch, db: Session = Depends(get_db)) -> dict:
    match = db.query(Match).filter(Match.id == mid).first()
    if not match:
        raise HTTPException(404, "Partita non trovata")
    if match.is_manually_locked:
        raise HTTPException(400, "Partita bloccata")

    slot = db.query(Slot).filter(Slot.id == payload.slot_id).first()
    if not slot:
        raise HTTPException(404, "Slot non trovato")

    occupied_by_other_match = (
        db.query(Match)
        .filter(Match.slot_id == payload.slot_id, Match.id != mid)
        .first()
    )
    if occupied_by_other_match:
        raise HTTPException(409, "Slot occupato")

    if match.slot_id and match.slot_id != payload.slot_id:
        previous_slot = db.query(Slot).filter(Slot.id == match.slot_id).first()
        if previous_slot:
            previous_slot.is_occupied = False

    match.slot_id = payload.slot_id
    match.status = MatchStatus.SCHEDULED
    slot.is_occupied = True
    db.commit()

    return {"ok": True, "match_id": mid, "slot_id": payload.slot_id}


@manual_router.patch("/{mid}/lock")
def set_match_lock(mid: str, payload: MatchLockPatch, db: Session = Depends(get_db)) -> dict:
    match = db.query(Match).filter(Match.id == mid).first()
    if not match:
        raise HTTPException(404, "Partita non trovata")

    match.is_manually_locked = payload.locked
    db.commit()
    return {"ok": True, "match_id": mid, "locked": payload.locked}
