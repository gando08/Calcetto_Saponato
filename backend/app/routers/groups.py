import math

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchPhase
from app.models.slot import Day, Slot
from app.models.team import Team
from app.models.tournament import Tournament, TournamentStatus
from app.services.group_balancing import build_balanced_groups, is_bye_team_id
from app.services.group_builder import build_compatibility_matrix, build_groups
from app.services.round_robin import generate_round_robin

router = APIRouter(prefix="/api/tournaments", tags=["groups"])


class GroupTeamsUpdate(BaseModel):
    team_ids: list[str]


def _enum_value(value: object) -> str:
    return getattr(value, "value", str(value))


def _slot_ids_for_tournament(tid: str, db: Session) -> list[str]:
    day_ids = [day.id for day in db.query(Day).filter(Day.tournament_id == tid).all()]
    if not day_ids:
        return []
    return [slot.id for slot in db.query(Slot).filter(Slot.day_id.in_(day_ids)).all()]


@router.post("/{tid}/groups/generate")
def generate_groups(tid: str, db: Session = Depends(get_db)) -> dict:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    existing_groups = db.query(Group).filter(Group.tournament_id == tid).all()
    for existing in existing_groups:
        db.delete(existing)
    db.flush()

    slot_ids = _slot_ids_for_tournament(tid, db)
    groups_created = 0
    matches_created = 0
    teams_per_group = max(2, int(tournament.teams_per_group or 4))

    for gender in ("M", "F"):
        teams = db.query(Team).filter(Team.tournament_id == tid, Team.gender == gender).all()
        if not teams:
            continue

        team_dicts = [
            {
                "id": team.id,
                "name": team.name,
                "unavailable_slot_ids": team.unavailable_slot_ids or [],
            }
            for team in teams
        ]
        teams_by_id = {team.id: team for team in teams}
        grouped_team_slots: list[list[str]]

        if gender == "F":
            # Keep female groups balanced by padding with virtual BYE slots.
            group_count = max(1, math.ceil(len(team_dicts) / teams_per_group))
            ordered_ids = [item["id"] for item in team_dicts]
            grouped_team_slots, _ = build_balanced_groups(ordered_ids, group_count)
        else:
            grouped_teams = build_groups(team_dicts, teams_per_group, slot_ids)
            grouped_team_slots = [[item["id"] for item in grouped] for grouped in grouped_teams]

        for index, grouped_slots in enumerate(grouped_team_slots):
            letter = chr(ord("A") + index)
            group = Group(
                tournament_id=tid,
                name=f"Girone {letter} ({gender})",
                gender=gender,
                phase=GroupPhase.GROUP,
            )
            real_team_ids = [team_id for team_id in grouped_slots if team_id in teams_by_id]
            group.teams = [teams_by_id[team_id] for team_id in real_team_ids]
            db.add(group)
            db.flush()
            groups_created += 1

            for team_home_id, team_away_id in generate_round_robin(grouped_slots):
                if is_bye_team_id(team_home_id) or is_bye_team_id(team_away_id):
                    continue
                db.add(
                    Match(
                        group_id=group.id,
                        team_home_id=team_home_id,
                        team_away_id=team_away_id,
                        phase=MatchPhase.GROUP,
                        round=1,
                    )
                )
                matches_created += 1

    tournament.status = TournamentStatus.GROUPS
    db.commit()
    return {"ok": True, "groups_created": groups_created, "matches_created": matches_created}


@router.get("/{tid}/groups")
def get_groups(tid: str, db: Session = Depends(get_db)) -> list[dict]:
    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.phase == GroupPhase.GROUP,
        )
        .order_by(Group.gender, Group.name)
        .all()
    )

    result: list[dict] = []
    for group in groups:
        matches_sorted = sorted(
            group.matches,
            key=lambda match: (match.round, _enum_value(match.phase), match.id),
        )
        result.append(
            {
                "id": group.id,
                "name": group.name,
                "gender": group.gender,
                "phase": _enum_value(group.phase),
                "teams": [{"id": team.id, "name": team.name, "gender": _enum_value(team.gender)} for team in group.teams],
                "matches": [
                    {
                        "id": match.id,
                        "phase": _enum_value(match.phase),
                        "round": match.round,
                        "status": _enum_value(match.status),
                        "team_home_id": match.team_home_id,
                        "team_away_id": match.team_away_id,
                        "team_home": match.team_home.name if match.team_home else match.placeholder_home,
                        "team_away": match.team_away.name if match.team_away else match.placeholder_away,
                        "slot_id": match.slot_id,
                    }
                    for match in matches_sorted
                ],
            }
        )
    return result


@router.get("/{tid}/groups/compatibility")
def get_groups_compatibility(tid: str, db: Session = Depends(get_db)) -> dict:
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    slot_ids = _slot_ids_for_tournament(tid, db)
    payload: dict[str, dict] = {}

    for gender in ("M", "F"):
        teams = db.query(Team).filter(Team.tournament_id == tid, Team.gender == gender).all()
        team_dicts = [
            {"id": team.id, "name": team.name, "unavailable_slot_ids": team.unavailable_slot_ids or []}
            for team in teams
        ]
        payload[gender] = {
            "teams": [{"id": team.id, "name": team.name} for team in teams],
            "matrix": build_compatibility_matrix(team_dicts, slot_ids),
        }

    return payload


@router.put("/{tid}/groups/{gid}/teams")
def update_group_teams(tid: str, gid: str, data: GroupTeamsUpdate, db: Session = Depends(get_db)) -> dict:
    group = (
        db.query(Group)
        .filter(
            Group.id == gid,
            Group.tournament_id == tid,
            Group.phase == GroupPhase.GROUP,
        )
        .first()
    )
    if not group:
        raise HTTPException(404, "Girone non trovato")

    ordered_team_ids: list[str] = list(dict.fromkeys(data.team_ids))
    if len(ordered_team_ids) < 2:
        raise HTTPException(400, "Servono almeno 2 squadre nel girone")

    teams = db.query(Team).filter(Team.tournament_id == tid, Team.id.in_(ordered_team_ids)).all()
    teams_by_id = {team.id: team for team in teams}
    if len(teams_by_id) != len(ordered_team_ids):
        raise HTTPException(400, "Una o piu squadre non sono valide per il torneo")

    group_gender = _enum_value(group.gender)
    if any(_enum_value(team.gender) != group_gender for team in teams):
        raise HTTPException(400, "Le squadre devono avere lo stesso genere del girone")

    selected_set = set(ordered_team_ids)
    sibling_groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.phase == GroupPhase.GROUP,
            Group.gender == group.gender,
        )
        .all()
    )
    for sibling in sibling_groups:
        if sibling.id == group.id:
            continue
        sibling.teams = [team for team in sibling.teams if team.id not in selected_set]

    group.teams = [teams_by_id[team_id] for team_id in ordered_team_ids]

    for match in list(group.matches):
        db.delete(match)
    db.flush()

    matches_created = 0
    for team_home_id, team_away_id in generate_round_robin(ordered_team_ids):
        db.add(
            Match(
                group_id=group.id,
                team_home_id=team_home_id,
                team_away_id=team_away_id,
                phase=MatchPhase.GROUP,
                round=1,
            )
        )
        matches_created += 1

    db.commit()
    return {"ok": True, "group_id": group.id, "teams": ordered_team_ids, "matches_created": matches_created}
