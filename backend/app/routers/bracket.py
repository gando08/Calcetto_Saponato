from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchPhase, MatchStatus
from app.models.team import Team
from app.services.bracket_generator import generate_bracket

router = APIRouter(prefix="/api/tournaments", tags=["bracket"])


class BracketAdvancePayload(BaseModel):
    match_id: str
    winner_team_id: str


def _phase_to_enum(phase: str) -> MatchPhase:
    phase_map = {
        "quarter": MatchPhase.QUARTER,
        "semi": MatchPhase.SEMI,
        "final": MatchPhase.FINAL,
        "third": MatchPhase.THIRD,
    }
    return phase_map.get(str(phase).lower(), MatchPhase.GROUP)


def _phase_to_str(phase: MatchPhase) -> str:
    return getattr(phase, "value", str(phase))


def _status_to_str(status: MatchStatus) -> str:
    return getattr(status, "value", str(status))


def _phase_sort_key(phase: MatchPhase) -> int:
    value = _phase_to_str(phase)
    order = {"group": 0, "quarter": 1, "semi": 2, "final": 3, "third": 4}
    return order.get(value, 99)


def _find_final_group(tid: str, gender: str, db: Session) -> Group | None:
    return (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender.upper(),
            Group.phase == GroupPhase.FINAL,
        )
        .order_by(Group.id)
        .first()
    )


def _serialize_bracket_matches(matches: list[Match], gender: str) -> list[dict]:
    sorted_matches = sorted(matches, key=lambda match: (match.round, _phase_sort_key(match.phase), match.id))
    round_positions: dict[int, int] = {}
    result: list[dict] = []

    for match in sorted_matches:
        phase_value = _phase_to_str(match.phase)
        if phase_value == "third":
            bracket_position = 99
        else:
            bracket_position = round_positions.get(match.round, 0)
            round_positions[match.round] = bracket_position + 1

        result.append(
            {
                "id": match.id,
                "phase": phase_value,
                "round": match.round,
                "gender": gender.upper(),
                "status": _status_to_str(match.status),
                "team_home_id": match.team_home_id,
                "team_away_id": match.team_away_id,
                "placeholder_home": match.team_home.name if match.team_home else match.placeholder_home,
                "placeholder_away": match.team_away.name if match.team_away else match.placeholder_away,
                "bracket_position": bracket_position,
                "prerequisite_match_home_id": match.prerequisite_match_home_id,
                "prerequisite_match_away_id": match.prerequisite_match_away_id,
            }
        )
    return result


@router.get("/{tid}/bracket/{gender}")
def get_final_bracket(tid: str, gender: str, db: Session = Depends(get_db)) -> dict:
    final_group = _find_final_group(tid, gender, db)
    if not final_group:
        return {"gender": gender.upper(), "matches": []}
    return {"gender": gender.upper(), "matches": _serialize_bracket_matches(list(final_group.matches), gender)}


@router.post("/{tid}/bracket/{gender}")
def generate_final_bracket(tid: str, gender: str, db: Session = Depends(get_db)) -> dict:
    gender_upper = gender.upper()
    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender_upper,
            Group.phase == GroupPhase.GROUP,
        )
        .all()
    )
    if not groups:
        raise HTTPException(404, "Nessun girone trovato per questo genere")

    existing_final_groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender_upper,
            Group.phase == GroupPhase.FINAL,
        )
        .all()
    )
    for final_group in existing_final_groups:
        db.delete(final_group)
    db.flush()

    advancing = []
    for group in groups:
        for idx, team in enumerate(group.teams[:2], start=1):
            advancing.append({"id": team.id, "name": team.name, "rank": idx, "group": group.name})

    wildcard_teams = []
    bracket = generate_bracket(advancing, wildcard_teams, [], gender_upper)

    final_group = Group(
        tournament_id=tid,
        name=f"Finali {gender_upper}",
        gender=gender_upper,
        phase=GroupPhase.FINAL,
    )
    db.add(final_group)
    db.flush()

    created_by_round_position: dict[tuple[int, int], Match] = {}
    third_match: Match | None = None
    sorted_payload = sorted(bracket, key=lambda item: (item.get("round", 0), item.get("bracket_position", 0)))

    for payload in sorted_payload:
        phase_value = str(payload.get("phase", "group"))
        round_value = int(payload.get("round", 1))
        position_value = int(payload.get("bracket_position", 0))
        match = Match(
            group_id=final_group.id,
            phase=_phase_to_enum(phase_value),
            round=round_value,
            team_home_id=payload.get("team_home_id"),
            team_away_id=payload.get("team_away_id"),
            placeholder_home=payload.get("placeholder_home"),
            placeholder_away=payload.get("placeholder_away"),
        )

        prereq_positions = payload.get("prerequisite_positions") or []
        if len(prereq_positions) == 2 and round_value > 1:
            prev_round = round_value - 1
            home_prev = created_by_round_position.get((prev_round, int(prereq_positions[0])))
            away_prev = created_by_round_position.get((prev_round, int(prereq_positions[1])))
            if home_prev:
                match.prerequisite_match_home_id = home_prev.id
            if away_prev:
                match.prerequisite_match_away_id = away_prev.id

        db.add(match)
        db.flush()

        if phase_value.lower() == "third":
            third_match = match
        else:
            created_by_round_position[(round_value, position_value)] = match

    if third_match:
        semifinal_round = max(third_match.round - 1, 1)
        semifinal_matches = [
            match
            for (round_key, _), match in created_by_round_position.items()
            if round_key == semifinal_round
        ]
        semifinal_matches = sorted(semifinal_matches, key=lambda match: match.id)[:2]
        if len(semifinal_matches) >= 2:
            third_match.prerequisite_match_home_id = semifinal_matches[0].id
            third_match.prerequisite_match_away_id = semifinal_matches[1].id

    db.commit()
    db.refresh(final_group)
    return {"gender": gender_upper, "matches": _serialize_bracket_matches(list(final_group.matches), gender_upper)}


@router.post("/{tid}/bracket/{gender}/advance")
def advance_bracket_match(tid: str, gender: str, payload: BracketAdvancePayload, db: Session = Depends(get_db)) -> dict:
    final_group = _find_final_group(tid, gender, db)
    if not final_group:
        raise HTTPException(404, "Bracket non trovato")

    match = (
        db.query(Match)
        .filter(
            Match.id == payload.match_id,
            Match.group_id == final_group.id,
        )
        .first()
    )
    if not match:
        raise HTTPException(404, "Partita del bracket non trovata")
    if payload.winner_team_id not in [match.team_home_id, match.team_away_id]:
        raise HTTPException(400, "La squadra vincitrice non appartiene alla partita")

    loser_team_id = match.team_away_id if payload.winner_team_id == match.team_home_id else match.team_home_id
    match.status = MatchStatus.PLAYED

    affected_team_ids = [payload.winner_team_id]
    if loser_team_id:
        affected_team_ids.append(loser_team_id)
    teams = db.query(Team).filter(Team.id.in_(affected_team_ids)).all()
    teams_by_id = {team.id: team for team in teams}

    downstream_matches = (
        db.query(Match)
        .filter(
            Match.group_id == final_group.id,
            (Match.prerequisite_match_home_id == match.id) | (Match.prerequisite_match_away_id == match.id),
        )
        .all()
    )

    updated_ids = []
    for downstream in downstream_matches:
        propagate_team_id = loser_team_id if downstream.phase == MatchPhase.THIRD else payload.winner_team_id
        if not propagate_team_id:
            continue

        team_name = teams_by_id.get(propagate_team_id).name if teams_by_id.get(propagate_team_id) else None
        if downstream.prerequisite_match_home_id == match.id:
            downstream.team_home_id = propagate_team_id
            downstream.placeholder_home = team_name or downstream.placeholder_home
            updated_ids.append(downstream.id)
        if downstream.prerequisite_match_away_id == match.id:
            downstream.team_away_id = propagate_team_id
            downstream.placeholder_away = team_name or downstream.placeholder_away
            updated_ids.append(downstream.id)

    db.commit()
    return {"ok": True, "updated_match_ids": sorted(set(updated_ids))}
