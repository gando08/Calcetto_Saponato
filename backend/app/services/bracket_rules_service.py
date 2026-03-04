import itertools
from typing import Any, Dict, List, Sequence, Tuple


FIRST_VS_SECOND_WARNING = "FIRST_VS_SECOND_CONSTRAINT_UNSATISFIED"
SAME_GROUP_WARNING = "SAME_GROUP_AVOIDANCE_CONSTRAINT_UNSATISFIED"
MAX_FIRST_ROUND_PAIRS = 8


def build_first_round_pairings(
    seed_pool: Sequence[Dict[str, Any]],
    bracket_size: int,
) -> Tuple[List[Tuple[Dict[str, Any] | None, Dict[str, Any] | None]], List[str]]:
    if bracket_size <= 0 or bracket_size % 2 != 0:
        raise ValueError("bracket_size must be a positive even number")
    first_round_pairs = bracket_size // 2
    if first_round_pairs > MAX_FIRST_ROUND_PAIRS:
        raise ValueError(f"Unsupported first-round pairs ({first_round_pairs}); maximum supported is {MAX_FIRST_ROUND_PAIRS}")
    if len(seed_pool) > bracket_size:
        raise ValueError("seed_pool cannot be larger than bracket_size")

    ordered_seeds = sorted((dict(row) for row in seed_pool), key=_seed_order_key)
    slots = _build_slots(ordered_seeds, bracket_size)
    half_size = bracket_size // 2

    home_slots = slots[:half_size]
    away_slots = slots[half_size:]
    selected_away_slots, score = _select_global_assignment(home_slots, away_slots, bracket_size)
    pairings = [(home_slot["team"], away_slot["team"]) for home_slot, away_slot in zip(home_slots, selected_away_slots)]
    warnings = _warnings_from_score(score)
    return pairings, warnings


def _build_slots(ordered_seeds: Sequence[Dict[str, Any]], bracket_size: int) -> List[Dict[str, Any]]:
    slots: List[Dict[str, Any]] = []
    for slot_seed in range(1, bracket_size + 1):
        idx = slot_seed - 1
        team = dict(ordered_seeds[idx]) if idx < len(ordered_seeds) else None
        slots.append({"slot_seed": slot_seed, "team": team})
    return slots


def _select_global_assignment(
    home_slots: Sequence[Dict[str, Any]],
    away_slots: Sequence[Dict[str, Any]],
    bracket_size: int,
) -> Tuple[List[Dict[str, Any]], tuple]:
    best_score: tuple | None = None
    best_permutation: tuple[int, ...] | None = None

    away_indexes = list(range(len(away_slots)))
    for permutation in itertools.permutations(away_indexes):
        score = _assignment_score(home_slots, away_slots, permutation, bracket_size)
        if best_score is None or score < best_score:
            best_score = score
            best_permutation = permutation

    if best_score is None or best_permutation is None:
        return [], (0, 0, 0, (), ())

    return [away_slots[idx] for idx in best_permutation], best_score


def _assignment_score(
    home_slots: Sequence[Dict[str, Any]],
    away_slots: Sequence[Dict[str, Any]],
    permutation: Sequence[int],
    bracket_size: int,
) -> tuple:
    same_group_violations = 0
    first_vs_second_violations = 0
    total_seed_distance = 0
    away_seed_signature: List[int] = []
    away_team_signature: List[str] = []

    for home_slot, away_idx in zip(home_slots, permutation):
        away_slot = away_slots[away_idx]
        home = home_slot["team"]
        away = away_slot["team"]
        target_seed = bracket_size - int(home_slot["slot_seed"]) + 1

        if _is_same_group(home, away):
            same_group_violations += 1
        if _is_first_place(home) and away is not None and not _is_second_place(away):
            first_vs_second_violations += 1

        if away is not None:
            total_seed_distance += abs(int(away_slot["slot_seed"]) - target_seed)
        away_seed_signature.append(int(away_slot["slot_seed"]))
        away_team_signature.append(str(away.get("team", "")) if away else "")

    return (
        same_group_violations,
        first_vs_second_violations,
        total_seed_distance,
        tuple(away_seed_signature),
        tuple(away_team_signature),
    )


def _warnings_from_score(score: tuple) -> List[str]:
    same_group_violations = int(score[0]) if len(score) > 0 else 0
    first_vs_second_violations = int(score[1]) if len(score) > 1 else 0

    warnings: List[str] = []
    if first_vs_second_violations > 0:
        warnings.append(FIRST_VS_SECOND_WARNING)
    if same_group_violations > 0:
        warnings.append(SAME_GROUP_WARNING)
    return warnings


def _seed_order_key(row: Dict[str, Any]) -> tuple:
    seed_value = row.get("seed")
    try:
        seed = int(seed_value)
    except (TypeError, ValueError):
        seed = 10**9
    return (seed, str(row.get("group", "")), str(row.get("team", "")))


def _is_first_place(row: Dict[str, Any] | None) -> bool:
    if not row:
        return False
    return _resolve_rank(row) == 1 and not bool(row.get("is_wildcard"))


def _is_second_place(row: Dict[str, Any] | None) -> bool:
    if not row:
        return False
    return _resolve_rank(row) == 2 and not bool(row.get("is_wildcard"))


def _resolve_rank(row: Dict[str, Any]) -> int:
    group_rank = _try_int(row.get("group_rank"))
    if group_rank is not None:
        return group_rank

    rank = _try_int(row.get("rank"))
    if rank is not None:
        return rank

    return 0


def _is_same_group(home: Dict[str, Any] | None, away: Dict[str, Any] | None) -> bool:
    if not home or not away:
        return False
    home_group = str(home.get("group", ""))
    away_group = str(away.get("group", ""))
    return bool(home_group) and home_group == away_group


def _try_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
