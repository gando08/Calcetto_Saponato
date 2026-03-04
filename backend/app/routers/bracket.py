import math

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchPhase, MatchStatus
from app.models.team import Team
from app.models.tournament import Tournament
from app.services.bracket_rules_service import build_first_round_pairings
from app.services.qualification_service import (
    DIRECT_QUALIFIERS_PER_GROUP,
    QualificationError,
    select_finalists,
)
from app.services.seeding_service import build_seed_pool
from app.services.standings_calculator import calculate_standings

router = APIRouter(prefix="/api/tournaments", tags=["bracket"])


class BracketAdvancePayload(BaseModel):
    match_id: str
    winner_team_id: str


class ManualBracketPayload(BaseModel):
    team_ids: list[str]


# ── Helpers ────────────────────────────────────────────────────────────────

def _next_power_of_2(n: int) -> int:
    return 2 ** math.ceil(math.log2(max(n, 2)))


def _phase_to_enum(phase: str) -> MatchPhase:
    phase_map = {
        "round16": MatchPhase.ROUND16,
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
    order = {"group": 0, "round16": 1, "quarter": 2, "semi": 3, "final": 4, "third": 5}
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


def _first_round_sort_key(match: Match) -> tuple:
    home_token = match.team_home_id or f"placeholder:{match.placeholder_home or ''}"
    away_token = match.team_away_id or f"placeholder:{match.placeholder_away or ''}"
    return (
        _phase_sort_key(match.phase),
        home_token,
        away_token,
        match.id,
    )


def _downstream_sort_key(match: Match, previous_positions: dict[str, int]) -> tuple:
    missing_position = 10**9
    home_position = previous_positions.get(match.prerequisite_match_home_id or "", missing_position)
    away_position = previous_positions.get(match.prerequisite_match_away_id or "", missing_position)
    return (
        _phase_sort_key(match.phase),
        home_position,
        away_position,
        str(match.prerequisite_match_home_id or ""),
        str(match.prerequisite_match_away_id or ""),
        str(match.placeholder_home or ""),
        str(match.placeholder_away or ""),
        match.id,
    )


def _stable_order_with_positions(matches: list[Match]) -> tuple[list[Match], dict[str, int]]:
    non_third_matches = [match for match in matches if _phase_to_str(match.phase) != "third"]
    rounds = sorted({int(match.round or 0) for match in non_third_matches})

    ordered: list[Match] = []
    positions_by_match_id: dict[str, int] = {}
    previous_round_positions: dict[str, int] = {}

    for idx, round_number in enumerate(rounds):
        round_matches = [match for match in non_third_matches if int(match.round or 0) == round_number]
        if idx == 0:
            round_matches = sorted(round_matches, key=_first_round_sort_key)
        else:
            round_matches = sorted(
                round_matches,
                key=lambda match: _downstream_sort_key(match, previous_round_positions),
            )

        current_round_positions: dict[str, int] = {}
        for position, match in enumerate(round_matches):
            positions_by_match_id[match.id] = position
            current_round_positions[match.id] = position
            ordered.append(match)

        previous_round_positions = current_round_positions

    return ordered, positions_by_match_id


def _serialize_bracket_matches(matches: list[Match], gender: str) -> list[dict]:
    ordered_non_third, positions_by_match_id = _stable_order_with_positions(matches)
    third_matches = sorted(
        (match for match in matches if _phase_to_str(match.phase) == "third"),
        key=lambda match: (int(match.round or 0), match.id),
    )

    result: list[dict] = []
    for match in [*ordered_non_third, *third_matches]:
        phase_value = _phase_to_str(match.phase)
        bracket_position = 99 if phase_value == "third" else positions_by_match_id.get(match.id, 0)
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


def _build_group_payload(groups: list[Group], tournament: Tournament) -> list[dict]:
    config = {
        "points_win": tournament.points_win,
        "points_draw": tournament.points_draw,
        "points_loss": tournament.points_loss,
    }
    tiebreakers = tournament.tiebreaker_order or []
    payload: list[dict] = []

    for group in sorted(groups, key=lambda item: item.name):
        team_ids = sorted(team.id for team in group.teams)
        matches_data = []
        for match in group.matches:
            if (
                match.status == MatchStatus.PLAYED
                and match.result
                and match.team_home_id
                and match.team_away_id
            ):
                matches_data.append(
                    {
                        "home": match.team_home_id,
                        "away": match.team_away_id,
                        "goals_home": match.result.goals_home,
                        "goals_away": match.result.goals_away,
                        "yellow_home": match.result.yellow_home,
                        "yellow_away": match.result.yellow_away,
                    }
                )

        standings_rows = calculate_standings(team_ids, matches_data, config, tiebreakers)
        standings_payload = []
        for row in standings_rows:
            standings_payload.append(
                {
                    "team": row.get("team"),
                    "points": row.get("points", 0),
                    "goal_diff": row.get("goal_diff", 0),
                    "goals_for": row.get("goals_for", 0),
                    "goals_against": row.get("goals_against", 0),
                    "yellow_cards": row.get("yellow_cards", 0),
                    "drawn": row.get("drawn", 0),
                }
            )

        matches_payload = [
            {
                "status": _status_to_str(match.status).lower(),
                "goals_home": match.result.goals_home if match.result else None,
                "goals_away": match.result.goals_away if match.result else None,
            }
            for match in group.matches
        ]

        payload.append(
            {
                "name": group.name,
                "standings": standings_payload,
                "matches": matches_payload,
            }
        )

    return payload


def _phase_for_round_size(round_size: int) -> str:
    if round_size <= 1:
        return "final"
    if round_size == 2:
        return "semi"
    if round_size == 4:
        return "quarter"
    if round_size == 8:
        return "round16"
    return "group"


def _build_bracket_payload(
    pairings: list[tuple[dict | None, dict | None]],
    target_size: int,
    gender: str,
) -> list[dict]:
    matches: list[dict] = []
    first_round_phase = _phase_for_round_size(target_size // 2)

    current_round: list[dict] = []
    for idx, (home, away) in enumerate(pairings):
        current_round_match = {
            "phase": first_round_phase,
            "round": 1,
            "gender": gender.upper(),
            "team_home_id": home["team"] if home else None,
            "team_away_id": away["team"] if away else None,
            "placeholder_home": home["team"] if home else f"Bye H{idx + 1}",
            "placeholder_away": away["team"] if away else f"Bye A{idx + 1}",
            "bracket_position": idx,
        }
        current_round.append(current_round_match)
        matches.append(current_round_match)

    round_num = 2
    while len(current_round) > 1:
        next_round: list[dict] = []
        next_round_size = len(current_round) // 2
        phase_name = _phase_for_round_size(next_round_size)

        for idx in range(0, len(current_round), 2):
            next_round_match = {
                "phase": phase_name,
                "round": round_num,
                "gender": gender.upper(),
                "team_home_id": None,
                "team_away_id": None,
                "placeholder_home": f"Vincitore Match {idx + 1}",
                "placeholder_away": f"Vincitore Match {idx + 2}",
                "bracket_position": idx // 2,
                "prerequisite_positions": [idx, idx + 1],
            }
            next_round.append(next_round_match)
            matches.append(next_round_match)

        current_round = next_round
        round_num += 1

    matches.append(
        {
            "phase": "third",
            "round": max(round_num - 1, 1),
            "gender": gender.upper(),
            "team_home_id": None,
            "team_away_id": None,
            "placeholder_home": "Perdente Semifinale 1",
            "placeholder_away": "Perdente Semifinale 2",
            "bracket_position": 99,
        }
    )
    return matches


def _save_bracket_to_db(
    bracket: list[dict],
    final_group: Group,
    db: Session,
) -> tuple[dict[tuple[int, int], Match], Match | None]:
    """Persist bracket match list to DB. Returns (created_by_round_position, third_match)."""
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
        semifinal_matches = sorted(
            (
                (position, match)
                for (round_key, position), match in created_by_round_position.items()
                if round_key == semifinal_round
            ),
            key=lambda item: item[0],
        )
        semifinal_matches_list = [m for _, m in semifinal_matches[:2]]
        if len(semifinal_matches_list) >= 2:
            third_match.prerequisite_match_home_id = semifinal_matches_list[0].id
            third_match.prerequisite_match_away_id = semifinal_matches_list[1].id

    return created_by_round_position, third_match


def _replace_final_group(tid: str, gender_upper: str, db: Session) -> Group:
    """Delete existing final group and create a fresh one."""
    existing_final_groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender_upper,
            Group.phase == GroupPhase.FINAL,
        )
        .all()
    )
    for fg in existing_final_groups:
        db.delete(fg)
    db.flush()

    final_group = Group(
        tournament_id=tid,
        name=f"Finali {gender_upper}",
        gender=gender_upper,
        phase=GroupPhase.FINAL,
    )
    db.add(final_group)
    db.flush()
    return final_group


# ── GET bracket teams with qualification status ────────────────────────────

@router.get("/{tid}/bracket/{gender}/teams")
def get_bracket_teams(tid: str, gender: str, db: Session = Depends(get_db)) -> list:
    gender_upper = gender.upper()
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender_upper,
            Group.phase == GroupPhase.GROUP,
        )
        .all()
    )

    config = {
        "points_win": tournament.points_win,
        "points_draw": tournament.points_draw,
        "points_loss": tournament.points_loss,
    }
    tiebreakers = tournament.tiebreaker_order or []

    result = []
    for group in sorted(groups, key=lambda g: g.name):
        all_matches = list(group.matches)
        total = len(all_matches)
        played = sum(1 for m in all_matches if m.status == MatchStatus.PLAYED)
        group_complete = total > 0 and played == total

        team_ids = [t.id for t in group.teams]
        matches_data = [
            {
                "home": m.team_home_id,
                "away": m.team_away_id,
                "goals_home": m.result.goals_home if m.result else 0,
                "goals_away": m.result.goals_away if m.result else 0,
                "yellow_home": m.result.yellow_home if m.result else 0,
                "yellow_away": m.result.yellow_away if m.result else 0,
            }
            for m in all_matches
            if m.status == MatchStatus.PLAYED and m.result
        ]

        standings_rows = calculate_standings(team_ids, matches_data, config, tiebreakers)
        team_names = {t.id: t.name for t in group.teams}

        for rank, row in enumerate(standings_rows, 1):
            result.append(
                {
                    "team_id": row["team"],
                    "team_name": team_names.get(row["team"], row["team"]),
                    "group": group.name,
                    "position": rank,
                    "points": row.get("points", 0),
                    "played": row.get("played", 0),
                    "goal_diff": row.get("goal_diff", 0),
                    "goals_for": row.get("goals_for", 0),
                    "group_complete": group_complete,
                    "matches_played": played,
                    "matches_total": total,
                    # confirmed = group done AND in top DIRECT_QUALIFIERS slots
                    "is_confirmed_direct": group_complete and rank <= DIRECT_QUALIFIERS_PER_GROUP,
                    "is_confirmed": group_complete,
                }
            )

    return result


# ── GET bracket ────────────────────────────────────────────────────────────

@router.get("/{tid}/bracket/{gender}")
def get_final_bracket(tid: str, gender: str, db: Session = Depends(get_db)) -> dict:
    final_group = _find_final_group(tid, gender, db)
    if not final_group:
        return {"gender": gender.upper(), "matches": []}
    return {"gender": gender.upper(), "matches": _serialize_bracket_matches(list(final_group.matches), gender)}


# ── POST bracket — auto generation (with optional force) ──────────────────

@router.post("/{tid}/bracket/{gender}")
def generate_final_bracket(
    tid: str,
    gender: str,
    force: bool = Query(False),
    db: Session = Depends(get_db),
) -> dict:
    gender_upper = gender.upper()
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

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

    group_payload = _build_group_payload(groups, tournament)
    try:
        selection = select_finalists(
            group_payload, gender_upper, tournament.tiebreaker_order or [], force=force
        )
    except QualificationError as exc:
        raise HTTPException(400, str(exc)) from exc

    seed_pool = build_seed_pool(
        selection["direct_qualifiers"],
        selection["wildcards"],
        tournament.tiebreaker_order or [],
    )
    pairings, warnings = build_first_round_pairings(seed_pool, int(selection["target_size"]))
    bracket = _build_bracket_payload(pairings, int(selection["target_size"]), gender_upper)

    final_group = _replace_final_group(tid, gender_upper, db)
    _save_bracket_to_db(bracket, final_group, db)

    db.commit()
    db.refresh(final_group)
    return {
        "gender": gender_upper,
        "target_size": int(selection["target_size"]),
        "direct_count": len(selection["direct_qualifiers"]),
        "wildcard_count": len(selection["wildcards"]),
        "warnings": warnings,
        "force": force,
        "matches": _serialize_bracket_matches(list(final_group.matches), gender_upper),
    }


# ── POST bracket/manual — explicit team list ───────────────────────────────

@router.post("/{tid}/bracket/{gender}/manual")
def generate_manual_bracket(
    tid: str,
    gender: str,
    payload: ManualBracketPayload,
    db: Session = Depends(get_db),
) -> dict:
    gender_upper = gender.upper()
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    if len(payload.team_ids) < 2:
        raise HTTPException(400, "Servono almeno 2 squadre per generare il bracket")

    # Gather current standings for the provided teams to enable proper seeding
    groups = (
        db.query(Group)
        .filter(
            Group.tournament_id == tid,
            Group.gender == gender_upper,
            Group.phase == GroupPhase.GROUP,
        )
        .all()
    )

    config = {
        "points_win": tournament.points_win,
        "points_draw": tournament.points_draw,
        "points_loss": tournament.points_loss,
    }
    tiebreakers = tournament.tiebreaker_order or []

    # Build standings-enriched data per team
    team_data: dict[str, dict] = {}
    for group in groups:
        team_ids = [t.id for t in group.teams]
        matches_data = [
            {
                "home": m.team_home_id,
                "away": m.team_away_id,
                "goals_home": m.result.goals_home if m.result else 0,
                "goals_away": m.result.goals_away if m.result else 0,
                "yellow_home": m.result.yellow_home if m.result else 0,
                "yellow_away": m.result.yellow_away if m.result else 0,
            }
            for m in group.matches
            if m.status == MatchStatus.PLAYED and m.result
        ]
        standings_rows = calculate_standings(team_ids, matches_data, config, tiebreakers)
        for rank, row in enumerate(standings_rows, 1):
            team_data[row["team"]] = {
                "team": row["team"],
                "group": group.name,
                "group_rank": rank,
                "points": row.get("points", 0),
                "goal_diff": row.get("goal_diff", 0),
                "goals_for": row.get("goals_for", 0),
                "goals_against": row.get("goals_against", 0),
                "yellow_cards": row.get("yellow_cards", 0),
                "drawn": row.get("drawn", 0),
            }

    # Validate teams exist in this tournament
    db_teams = db.query(Team).filter(Team.id.in_(payload.team_ids), Team.tournament_id == tid).all()
    db_team_ids = {t.id for t in db_teams}
    missing = [tid_item for tid_item in payload.team_ids if tid_item not in db_team_ids]
    if missing:
        raise HTTPException(400, f"Squadre non trovate in questo torneo: {missing}")

    # Build qualifier list for seeding (all treated as direct qualifiers)
    qualifiers = []
    for i, team_id in enumerate(payload.team_ids):
        data = team_data.get(team_id, {
            "team": team_id, "group": "manual", "group_rank": i + 1,
            "points": 0, "goal_diff": 0, "goals_for": 0,
            "goals_against": 0, "yellow_cards": 0, "drawn": 0,
        })
        qualifiers.append(data)

    target_size = _next_power_of_2(len(payload.team_ids))
    try:
        seed_pool = build_seed_pool(qualifiers, [], tiebreakers)
        pairings, warnings = build_first_round_pairings(seed_pool, target_size)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    bracket = _build_bracket_payload(pairings, target_size, gender_upper)

    final_group = _replace_final_group(tid, gender_upper, db)
    _save_bracket_to_db(bracket, final_group, db)

    db.commit()
    db.refresh(final_group)
    return {
        "gender": gender_upper,
        "target_size": target_size,
        "team_count": len(payload.team_ids),
        "warnings": warnings,
        "mode": "manual",
        "matches": _serialize_bracket_matches(list(final_group.matches), gender_upper),
    }


# ── POST bracket advance ───────────────────────────────────────────────────

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

        if downstream.prerequisite_match_home_id == match.id:
            downstream.team_home_id = propagate_team_id
            updated_ids.append(downstream.id)
        if downstream.prerequisite_match_away_id == match.id:
            downstream.team_away_id = propagate_team_id
            updated_ids.append(downstream.id)

    db.commit()
    return {"ok": True, "updated_match_ids": sorted(set(updated_ids))}
