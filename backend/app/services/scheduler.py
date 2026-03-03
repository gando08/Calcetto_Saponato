from typing import Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.group import Group
from app.models.match import Match, MatchStatus
from app.models.slot import Day, Slot
from app.models.team import Team
from app.models.tournament import Tournament
from app.solver.cp_sat_solver import TournamentScheduler

_active_solvers: Dict[str, TournamentScheduler] = {}


def get_solver_status(tournament_id: str) -> Dict:
    solver = _active_solvers.get(tournament_id)
    if not solver:
        return {"status": "idle"}
    return {"status": solver.status, "result": solver.result}


def _collect_tournament_data(
    tournament_id: str, db: Session
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (slot_dicts, match_dicts, team_dicts) for a single tournament."""
    slots = (
        db.query(Slot)
        .join(Day, Slot.day_id == Day.id)
        .filter(Day.tournament_id == tournament_id)
        .all()
    )
    matches = (
        db.query(Match)
        .join(Group, Match.group_id == Group.id)
        .filter(Group.tournament_id == tournament_id)
        .all()
    )
    teams = db.query(Team).filter(Team.tournament_id == tournament_id).all()

    slot_dicts = [
        {
            "id": slot.id,
            "tournament_id": tournament_id,
            "day_id": slot.day_id,
            "date": slot.day.date if slot.day else "",
            "start_time": slot.start_time,
            "end_time": slot.end_time,
            "is_finals_day": slot.day.is_finals_day if slot.day else False,
        }
        for slot in slots
    ]
    match_dicts = [
        {
            "id": match.id,
            "tournament_id": tournament_id,
            "team_home_id": match.team_home_id,
            "team_away_id": match.team_away_id,
            "phase": str(match.phase),
            "slot_id": match.slot_id,
            "is_manually_locked": match.is_manually_locked,
        }
        for match in matches
    ]
    team_dicts = [
        {
            "id": team.id,
            "unavailable_slot_ids": team.unavailable_slot_ids or [],
            "preferred_days": team.preferred_days or [],
            "preferred_time_windows": team.preferred_time_windows or [],
            "prefers_consecutive": team.prefers_consecutive,
        }
        for team in teams
    ]
    return slot_dicts, match_dicts, team_dicts


def start_scheduling(
    tournament_id: str,
    db: Session,
    on_progress: Callable[[Dict], None],
    companion_tids: Optional[List[str]] = None,
) -> None:
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise ValueError("Tournament not found")

    all_slots: list[dict] = []
    all_matches: list[dict] = []
    all_teams: list[dict] = []

    for tid in [tournament_id] + (companion_tids or []):
        s, m, t = _collect_tournament_data(tid, db)
        all_slots.extend(s)
        all_matches.extend(m)
        all_teams.extend(t)

    config = {"penalty_weights": tournament.penalty_weights or {}}
    solver = TournamentScheduler(config=config, on_progress=on_progress)

    # Register solver under all tournament IDs so apply() works from any of them
    _active_solvers[tournament_id] = solver
    for tid in (companion_tids or []):
        _active_solvers[tid] = solver

    solver.schedule_async(all_matches, all_slots, all_teams)


def apply_solution(tournament_id: str, db: Session) -> bool:
    solver = _active_solvers.get(tournament_id)
    if not solver or solver.status != "done" or not solver.result:
        return False

    assignment = solver.result["assignment"]
    for match_id, slot_id in assignment.items():
        match = db.query(Match).filter(Match.id == match_id).first()
        if not match:
            continue
        match.slot_id = slot_id
        match.status = MatchStatus.SCHEDULED

        slot = db.query(Slot).filter(Slot.id == slot_id).first()
        if slot:
            slot.is_occupied = True

    db.commit()
    return True
