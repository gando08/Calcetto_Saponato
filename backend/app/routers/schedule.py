import asyncio
from collections import Counter, defaultdict
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group
from app.models.match import Match, MatchStatus
from app.models.slot import Slot
from app.models.team import Team
from app.services import scheduler as scheduler_service
from app.services.tournament_pairing import resolve_pair_tournament_ids

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


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _is_preferred_day(preferred_days: list, day_id: str, day_label: str, day_date: str) -> bool:
    if not preferred_days:
        return True
    normalized = {_norm(str(item)) for item in preferred_days}
    return _norm(day_id) in normalized or _norm(day_label) in normalized or _norm(day_date) in normalized


def _is_preferred_window(preferred_windows: list, start_time: str) -> bool:
    if not preferred_windows:
        return True
    for window in preferred_windows:
        start = window.get("start")
        end = window.get("end")
        if not start or not end:
            continue
        if start <= start_time < end:
            return True
    return False


@router.post("/{tid}/schedule/generate")
async def generate_schedule(
    tid: str,
    body: GenerateBody = Body(default_factory=GenerateBody),
    db: Session = Depends(get_db),
) -> dict:
    pair_ids = resolve_pair_tournament_ids(tid, db)
    auto_companion_ids = [x for x in pair_ids if x != tid]
    requested_companions = [x for x in (body.companion_tournament_ids or []) if x and x != tid]
    companion_ids = list(dict.fromkeys([*auto_companion_ids, *requested_companions]))
    loop = asyncio.get_event_loop()
    all_tids = [tid] + companion_ids

    def on_progress(data: dict) -> None:
        for broadcast_tid in all_tids:
            asyncio.run_coroutine_threadsafe(broadcast(broadcast_tid, data), loop)

    scheduler_service.start_scheduling(tid, db, on_progress, companion_tids=companion_ids)
    return {"status": "started"}


@router.get("/{tid}/schedule/status")
def schedule_status(tid: str) -> dict:
    return scheduler_service.get_solver_status(tid)


@router.get("/{tid}/schedule/quality")
def schedule_quality(tid: str, db: Session = Depends(get_db)) -> dict:
    slots = (
        db.query(Slot)
        .join(Slot.day)
        .filter(Slot.day.has(tournament_id=tid))
        .all()
    )
    slot_by_id = {slot.id: slot for slot in slots}
    # Sort slots to get a stable index for "consecutive" check
    sorted_slots_list = sorted(slots, key=lambda s: (s.day.date, s.start_time))
    slot_id_to_index = {slot.id: i for i, slot in enumerate(sorted_slots_list)}

    matches = (
        db.query(Match)
        .join(Group, Match.group_id == Group.id)
        .filter(Group.tournament_id == tid)
        .all()
    )
    team_ids = {team_id for match in matches for team_id in [match.team_home_id, match.team_away_id] if team_id}  
    teams = db.query(Team).filter(Team.id.in_(team_ids)).all() if team_ids else []
    teams_by_id = {team.id: team for team in teams}

    total = len(matches)
    scheduled = sum(1 for m in matches if m.slot_id is not None)
    locked = sum(1 for m in matches if m.is_manually_locked)
    slot_ids = [m.slot_id for m in matches if m.slot_id]
    conflicts = max(0, len(slot_ids) - len(set(slot_ids)))
    slot_counts = Counter(slot_ids)
    conflicted_slot_ids = {slot_id for slot_id, count in slot_counts.items() if count > 1}

    hard_violations = 0
    soft_violations = 0
    preference_checks = 0
    preference_respected = 0
    alerts: list[dict] = []
    match_health: dict[str, dict] = {}
    team_day_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    team_slot_indices: dict[str, list[int]] = defaultdict(list)

    # Pre-populate team slot indices
    for m in matches:
        if m.slot_id and m.slot_id in slot_id_to_index:
            idx = slot_id_to_index[m.slot_id]
            if m.team_home_id: team_slot_indices[m.team_home_id].append(idx)
            if m.team_away_id: team_slot_indices[m.team_away_id].append(idx)

    for match in matches:
        hard_reasons: list[str] = []
        soft_reasons: list[str] = []

        if not match.slot_id:
            match_health[match.id] = {"level": "hard", "hard": ["non_schedulato"], "soft": []}  
            hard_violations += 1
            continue

        slot = slot_by_id.get(match.slot_id)
        if not slot or not slot.day:
            hard_reasons.append("slot_non_valido")
        else:
            for team_id in [match.team_home_id, match.team_away_id]:
                if team_id:
                    team_day_counts[team_id][slot.day_id] += 1

            if match.slot_id in conflicted_slot_ids:
                hard_reasons.append("slot_conflitto")

            for team_id in [match.team_home_id, match.team_away_id]:
                if not team_id:
                    continue
                team = teams_by_id.get(team_id)
                if not team:
                    continue

                if match.slot_id in (team.unavailable_slot_ids or []):
                    hard_reasons.append(f"indisponibilita:{team.name}")

                pref_days = team.preferred_days or []
                if pref_days:
                    preference_checks += 1
                    if _is_preferred_day(pref_days, slot.day_id, slot.day.label, slot.day.date):
                        preference_respected += 1
                    else:
                        soft_reasons.append(f"giorno_non_preferito:{team.name}")

                pref_windows = team.preferred_time_windows or []
                if pref_windows:
                    preference_checks += 1
                    if _is_preferred_window(pref_windows, slot.start_time):
                        preference_respected += 1
                    else:
                        soft_reasons.append(f"fascia_non_preferita:{team.name}")

                # Check for 3+ consecutive
                indices = sorted(team_slot_indices[team_id])
                for i in range(len(indices) - 2):
                    if indices[i+1] == indices[i] + 1 and indices[i+2] == indices[i+1] + 1:
                        curr_idx = slot_id_to_index[match.slot_id]
                        if curr_idx in [indices[i], indices[i+1], indices[i+2]]:
                            soft_reasons.append(f"3_partite_consecutive:{team.name}")
                            break

        hard_violations += len(hard_reasons)
        soft_violations += len(soft_reasons)
        level = "hard" if hard_reasons else ("soft" if soft_reasons else "ok")
        match_health[match.id] = {"level": level, "hard": hard_reasons, "soft": soft_reasons}

        if soft_reasons or hard_reasons:
            alerts.append(
                {
                    "match_id": match.id,
                    "severity": level,
                    "message": f"{match.team_home.name if match.team_home else '?'} vs {match.team_away.name if match.team_away else '?'}",
                    "reasons": hard_reasons + soft_reasons,
                }
            )

    team_scores = []
    for day_counts in team_day_counts.values():
        total_team_matches = sum(day_counts.values())
        if total_team_matches <= 1:
            team_scores.append(1.0)
            continue
        values = list(day_counts.values())
        imbalance = (max(values) - min(values)) / total_team_matches
        team_scores.append(max(0.0, 1.0 - imbalance))

    total_slots = len(slots)
    preferences_respected_pct = round(preference_respected / preference_checks * 100, 1) if preference_checks > 0 else 100.0

    return {
        "total_matches": total,
        "scheduled_matches": scheduled,
        "unscheduled_matches": total - scheduled,
        "coverage_pct": round(scheduled / total * 100, 1) if total > 0 else 0.0,
        "locked_matches": locked,
        "slot_conflicts": conflicts,
        "total_slots": total_slots,
        "slots_utilized": scheduled,
        "hard_violations": hard_violations,
        "soft_violations": soft_violations,
        "preference_checks": preference_checks,
        "preference_respected": preference_respected,
        "preferences_respected_pct": preferences_respected_pct,
        "equity_index": round(sum(team_scores) / len(team_scores), 2) if team_scores else 1.0,
        "alerts": alerts[:20],
        "match_health": match_health,
    }

@router.post("/{tid}/schedule/apply")
def apply_schedule(tid: str, db: Session = Depends(get_db)) -> dict:
    return save_schedule(tid, db)


@router.post("/{tid}/schedule/save")
def save_schedule(tid: str, db: Session = Depends(get_db)) -> dict:
    pair_ids = resolve_pair_tournament_ids(tid, db)
    saved = 0
    for pair_tid in pair_ids:
        if scheduler_service.apply_solution(pair_tid, db):
            saved += 1
    if saved == 0:
        raise HTTPException(400, "Nessuna soluzione disponibile")
    return {"ok": True, "saved_tournaments": saved}


@router.post("/{tid}/schedule/unschedule-all")
def unschedule_all(tid: str, db: Session = Depends(get_db)) -> dict:
    pair_ids = resolve_pair_tournament_ids(tid, db)
    matches = (
        db.query(Match)
        .join(Group, Match.group_id == Group.id)
        .filter(Group.tournament_id.in_(pair_ids))
        .all()
    )

    unscheduled = 0
    skipped_played = 0
    for match in matches:
        if match.status == MatchStatus.PLAYED:
            skipped_played += 1
            continue
        if match.slot_id:
            previous_slot = db.query(Slot).filter(Slot.id == match.slot_id).first()
            if previous_slot:
                previous_slot.is_occupied = False
        match.slot_id = None
        match.is_manually_locked = False
        match.status = MatchStatus.PENDING
        unscheduled += 1

    db.commit()
    return {"ok": True, "unscheduled_matches": unscheduled, "skipped_played_matches": skipped_played}


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
                    "day_id": match.slot.day_id,
                    "date": match.slot.day.date if match.slot.day else "",
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
    if match.status == MatchStatus.PLAYED:
        raise HTTPException(400, "Partita già giocata: modifica non consentita")
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
    if match.status == MatchStatus.PLAYED:
        raise HTTPException(400, "Partita già giocata: modifica non consentita")

    match.is_manually_locked = payload.locked
    db.commit()
    return {"ok": True, "match_id": mid, "locked": payload.locked}


@manual_router.patch("/{mid}/unschedule")
def unschedule_match(mid: str, db: Session = Depends(get_db)) -> dict:
    match = db.query(Match).filter(Match.id == mid).first()
    if not match:
        raise HTTPException(404, "Partita non trovata")
    if match.status == MatchStatus.PLAYED:
        raise HTTPException(400, "Partita già giocata: modifica non consentita")

    previous_slot_id = match.slot_id
    match.slot_id = None
    match.is_manually_locked = False
    match.status = MatchStatus.PENDING

    if previous_slot_id:
        previous_slot = db.query(Slot).filter(Slot.id == previous_slot_id).first()
        if previous_slot:
            previous_slot.is_occupied = False

    db.commit()
    return {"ok": True, "match_id": mid}
