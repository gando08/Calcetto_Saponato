from typing import Any, Dict, List, Sequence


_DESCENDING_FIELDS = {"points", "goal_diff", "goals_for", "draw", "head_to_head"}
_ASCENDING_FIELDS = {"goals_against", "fair_play"}
_TIEBREAKER_TO_FIELD = {
    "draw": "drawn",
    "fair_play": "yellow_cards",
}


def build_seed_pool(
    direct_qualifiers: Sequence[Dict[str, Any]],
    wildcards: Sequence[Dict[str, Any]],
    tiebreaker_order: Sequence[str],
) -> List[Dict[str, Any]]:
    first_places: List[Dict[str, Any]] = []
    second_places: List[Dict[str, Any]] = []
    other_directs: List[Dict[str, Any]] = []

    for row in direct_qualifiers:
        prepared = {**row, "is_wildcard": False}
        rank = _resolve_rank(prepared)
        prepared["group_rank"] = rank

        if rank == 1:
            first_places.append(prepared)
        elif rank == 2:
            second_places.append(prepared)
        else:
            other_directs.append(prepared)

    prepared_wildcards = [{**row, "is_wildcard": True} for row in wildcards]

    seed_pool: List[Dict[str, Any]] = []
    seed_pool.extend(sorted(first_places, key=lambda row: _seed_sort_key(row, tiebreaker_order)))
    seed_pool.extend(sorted(second_places, key=lambda row: _seed_sort_key(row, tiebreaker_order)))
    seed_pool.extend(sorted(other_directs, key=lambda row: _seed_sort_key(row, tiebreaker_order)))
    seed_pool.extend(sorted(prepared_wildcards, key=lambda row: _seed_sort_key(row, tiebreaker_order)))

    for seed, row in enumerate(seed_pool, start=1):
        row["seed"] = seed

    return seed_pool


def _resolve_rank(row: Dict[str, Any]) -> int:
    group_rank = _try_int(row.get("group_rank"))
    if group_rank is not None:
        return group_rank

    rank = _try_int(row.get("rank"))
    if rank is not None:
        return rank

    return 0


def _seed_sort_key(row: Dict[str, Any], tiebreaker_order: Sequence[str]) -> tuple:
    key_parts: List[Any] = []
    key_parts.append(-_safe_int(row.get("points")))

    for criterion in tiebreaker_order:
        criterion_name = str(criterion).lower()
        field = _TIEBREAKER_TO_FIELD.get(criterion_name, criterion_name)
        value = _safe_int(row.get(field))

        if criterion_name in _DESCENDING_FIELDS:
            key_parts.append(-value)
        elif criterion_name in _ASCENDING_FIELDS:
            key_parts.append(value)
        else:
            key_parts.append(value)

    key_parts.append(str(row.get("group", "")))
    key_parts.append(str(row.get("team", "")))
    return tuple(key_parts)


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _try_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
