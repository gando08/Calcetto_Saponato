from typing import Any, Dict, List, Sequence


DIRECT_QUALIFIERS_PER_GROUP = 2
MALE_DEFAULT_TARGET = 8
MALE_EXTENDED_TARGET = 16
FEMALE_TARGET = 4
WILDCARD_TIEBREAKER_FIELDS = {
    "goal_diff": "goal_diff",
    "goals_for": "goals_for",
    "goals_against": "goals_against",
    "fair_play": "yellow_cards",
    "draw": "drawn",
}
SUPPORTED_TIEBREAKERS = set(WILDCARD_TIEBREAKER_FIELDS.keys()) | {"head_to_head"}


class QualificationError(ValueError):
    pass


def select_finalists(groups: Sequence[Dict[str, Any]], gender: str, tiebreaker_order: Sequence[str]) -> Dict[str, Any]:
    if not _is_group_phase_closed(groups):
        raise QualificationError("Group phase is not closed")
    wildcard_tiebreakers = _normalize_wildcard_tiebreakers(tiebreaker_order)

    ordered_groups = sorted(groups, key=lambda group: str(group.get("name", "")))
    direct_qualifiers: List[Dict[str, Any]] = []
    wildcard_candidates: List[Dict[str, Any]] = []

    for group in ordered_groups:
        group_name = str(group.get("name", ""))
        standings = list(group.get("standings") or [])
        for rank, row in enumerate(standings, start=1):
            enriched_row = {**row, "group": group_name, "group_rank": rank}
            if rank <= DIRECT_QUALIFIERS_PER_GROUP:
                direct_qualifiers.append(enriched_row)
            else:
                wildcard_candidates.append(enriched_row)

    target_size = _resolve_target_size(gender, len(direct_qualifiers))
    wildcard_slots = target_size - len(direct_qualifiers)
    if wildcard_slots < 0:
        raise QualificationError(f"Too many direct qualifiers ({len(direct_qualifiers)}) for target {target_size}")

    ranked_wildcards = sorted(
        wildcard_candidates,
        key=lambda row: _wildcard_sort_key(row, wildcard_tiebreakers),
    )

    if len(ranked_wildcards) < wildcard_slots:
        raise QualificationError("Not enough wildcard candidates to fill finals")

    selected_wildcards = ranked_wildcards[:wildcard_slots]
    qualified_teams = [*direct_qualifiers, *selected_wildcards]
    return {
        "gender": str(gender).upper(),
        "target_size": target_size,
        "direct_qualifiers": direct_qualifiers,
        "wildcards": selected_wildcards,
        "qualified_teams": qualified_teams,
    }


def _resolve_target_size(gender: str, direct_count: int) -> int:
    gender_upper = str(gender).upper()
    if gender_upper == "M":
        return MALE_EXTENDED_TARGET if direct_count > MALE_DEFAULT_TARGET else MALE_DEFAULT_TARGET
    if gender_upper == "F":
        if direct_count > FEMALE_TARGET:
            raise QualificationError("Female finals can have at most 4 direct qualifiers")
        return FEMALE_TARGET
    raise QualificationError(f"Unsupported gender: {gender}")


def _is_group_phase_closed(groups: Sequence[Dict[str, Any]]) -> bool:
    for group in groups:
        matches = list(group.get("matches") or [])
        if not matches:
            return False
        for match in matches:
            status = str(match.get("status", "")).lower()
            if status:
                if status != "played":
                    return False
                continue
            if match.get("goals_home") is None or match.get("goals_away") is None:
                return False
    return True


def _normalize_wildcard_tiebreakers(tiebreaker_order: Sequence[str]) -> List[str]:
    wildcard_order: List[str] = []
    for item in tiebreaker_order:
        criterion = str(item).lower()
        if criterion not in SUPPORTED_TIEBREAKERS:
            raise QualificationError(f"Unsupported tiebreaker criterion: {item}")
        if criterion != "head_to_head":
            wildcard_order.append(criterion)
    return wildcard_order


def _wildcard_sort_key(row: Dict[str, Any], wildcard_tiebreakers: Sequence[str]) -> tuple:
    key_parts: List[Any] = [-_require_int(row, "points")]

    for criterion in wildcard_tiebreakers:
        stat_name = WILDCARD_TIEBREAKER_FIELDS[criterion]
        value = _require_int(row, stat_name)
        if criterion in {"goal_diff", "goals_for", "draw"}:
            key_parts.append(-value)
        else:
            key_parts.append(value)

    key_parts.append(str(row.get("group", "")))
    key_parts.append(str(row.get("team", "")))
    return tuple(key_parts)


def _require_int(row: Dict[str, Any], field: str) -> int:
    value = row.get(field)
    try:
        return int(value)
    except (TypeError, ValueError):
        team_name = row.get("team", "<unknown>")
        raise QualificationError(f"Invalid numeric stat '{field}' for team '{team_name}'")
