import asyncio
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group
from app.models.match import Match
from app.services.scheduler import apply_solution, get_solver_status, start_scheduling

router = APIRouter(prefix="/api/tournaments", tags=["schedule"])
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


@router.post("/{tid}/schedule/generate")
async def generate_schedule(tid: str, db: Session = Depends(get_db)) -> dict:
    def on_progress(data: dict) -> None:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(broadcast(tid, data))
        loop.close()

    start_scheduling(tid, db, on_progress)
    return {"status": "started"}


@router.get("/{tid}/schedule/status")
def schedule_status(tid: str) -> dict:
    return get_solver_status(tid)


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
                "team_home": match.team_home.name if match.team_home else match.placeholder_home,
                "team_away": match.team_away.name if match.team_away else match.placeholder_away,
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
