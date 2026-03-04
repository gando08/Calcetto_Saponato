from typing import Any

import pytest

from app.services.bracket_rules_service import build_first_round_pairings
from app.services.seeding_service import build_seed_pool


def _row(
    team: str,
    group: str,
    group_rank: Any,
    *,
    rank: int | None = None,
    points: int = 0,
    goal_diff: int = 0,
    goals_for: int = 0,
    goals_against: int = 0,
    yellow_cards: int = 0,
    seed: int | None = None,
    is_wildcard: bool = False,
) -> dict:
    payload = {
        "team": team,
        "group": group,
        "group_rank": group_rank,
        "points": points,
        "goal_diff": goal_diff,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "yellow_cards": yellow_cards,
        "is_wildcard": is_wildcard,
    }
    if seed is not None:
        payload["seed"] = seed
    if rank is not None:
        payload["rank"] = rank
    return payload


def test_first_round_prefers_first_vs_second_pairings() -> None:
    direct_qualifiers = [
        _row("A1", "A", 1, points=9),
        _row("A2", "A", 2, points=6),
        _row("B1", "B", 1, points=8),
        _row("B2", "B", 2, points=5),
        _row("C1", "C", 1, points=7),
        _row("C2", "C", 2, points=4),
        _row("D1", "D", 1, points=6),
        _row("D2", "D", 2, points=3),
    ]

    seed_pool = build_seed_pool(direct_qualifiers, [], ["goal_diff", "goals_for"])
    pairings, warnings = build_first_round_pairings(seed_pool, 8)

    assert warnings == []
    assert len(pairings) == 4
    assert all(home is not None and away is not None for home, away in pairings)
    assert all(home["group_rank"] == 1 and away["group_rank"] == 2 for home, away in pairings)


def test_first_round_avoids_same_group_clashes_when_possible() -> None:
    seed_pool = [
        _row("A1", "A", 1, seed=1),
        _row("B1", "B", 1, seed=2),
        _row("C1", "C", 1, seed=3),
        _row("D1", "D", 1, seed=4),
        _row("D2", "D", 2, seed=5),
        _row("C2", "C", 2, seed=6),
        _row("B2", "B", 2, seed=7),
        _row("A2", "A", 2, seed=8),
    ]

    pairings, warnings = build_first_round_pairings(seed_pool, 8)

    assert warnings == []
    assert all(home["group"] != away["group"] for home, away in pairings)


def test_wildcards_are_seeded_last() -> None:
    direct_qualifiers = [
        _row("A1", "A", 1, points=9, goal_diff=5),
        _row("A2", "A", 2, points=6, goal_diff=2),
        _row("B1", "B", 1, points=8, goal_diff=4),
        _row("B2", "B", 2, points=5, goal_diff=1),
    ]
    wildcards = [
        _row("WC1", "C", 3, points=4, goal_diff=1, is_wildcard=True),
        _row("WC2", "D", 3, points=3, goal_diff=0, is_wildcard=True),
    ]

    seed_pool = build_seed_pool(direct_qualifiers, wildcards, ["goal_diff", "goals_for"])

    assert [row["seed"] for row in seed_pool] == [1, 2, 3, 4, 5, 6]
    assert all(not row["is_wildcard"] for row in seed_pool[:-2])
    assert all(row["is_wildcard"] for row in seed_pool[-2:])
    assert [row["team"] for row in seed_pool[-2:]] == ["WC1", "WC2"]


def test_pairing_reports_warning_when_constraints_cannot_all_hold() -> None:
    seed_pool = [
        _row("A1", "A", 1, seed=1),
        _row("B1", "B", 1, seed=2),
        _row("A2", "A", 2, seed=3),
        _row("A3", "A", 3, seed=4, is_wildcard=True),
    ]

    pairings, warnings = build_first_round_pairings(seed_pool, 4)

    assert len(pairings) == 2
    assert "FIRST_VS_SECOND_CONSTRAINT_UNSATISFIED" in warnings
    assert "SAME_GROUP_AVOIDANCE_CONSTRAINT_UNSATISFIED" in warnings


def test_pairing_is_deterministic() -> None:
    direct_qualifiers = [
        _row("A1", "A", 1, points=9),
        _row("A2", "A", 2, points=6),
        _row("B1", "B", 1, points=8),
        _row("B2", "B", 2, points=5),
        _row("C1", "C", 1, points=7),
        _row("C2", "C", 2, points=4),
        _row("D1", "D", 1, points=6),
        _row("D2", "D", 2, points=3),
    ]
    seed_pool = build_seed_pool(direct_qualifiers, [], ["goal_diff", "goals_for"])

    pairings_first, warnings_first = build_first_round_pairings(seed_pool, 8)
    pairings_second, warnings_second = build_first_round_pairings(seed_pool, 8)

    assert pairings_first == pairings_second
    assert warnings_first == warnings_second


def test_global_pairing_avoids_greedy_same_group_artifact() -> None:
    seed_pool = [
        _row("C1", "C", 1, seed=1),
        _row("D1", "D", 1, seed=2),
        _row("B1", "B", 1, seed=3),
        _row("A1", "A", 1, seed=4),
        _row("A2a", "A", 2, seed=5),
        _row("A2b", "A", 2, seed=6),
        _row("A2c", "A", 2, seed=7),
        _row("B2", "B", 2, seed=8),
    ]

    pairings, warnings = build_first_round_pairings(seed_pool, 8)

    assert all(home["group"] != away["group"] for home, away in pairings)
    assert "SAME_GROUP_AVOIDANCE_CONSTRAINT_UNSATISFIED" not in warnings


def test_byes_do_not_trigger_first_vs_second_warning() -> None:
    seed_pool = [
        _row("A1", "A", 1, seed=1),
        _row("B1", "B", 1, seed=2),
        _row("C1", "C", 1, seed=3),
        _row("D1", "D", 1, seed=4),
        _row("E2", "E", 2, seed=5),
        _row("F2", "F", 2, seed=6),
    ]

    pairings, warnings = build_first_round_pairings(seed_pool, 8)

    assert len(pairings) == 4
    assert "FIRST_VS_SECOND_CONSTRAINT_UNSATISFIED" not in warnings


def test_rejects_oversized_first_round_search_space() -> None:
    with pytest.raises(ValueError, match="first-round pairs"):
        build_first_round_pairings([], 18)


def test_invalid_group_rank_falls_back_to_rank_for_pairing_rules() -> None:
    direct_qualifiers = [
        _row("A1", "A", "", rank=1, points=9),
        _row("A2", "A", "", rank=2, points=6),
        _row("B1", "B", "", rank=1, points=8),
        _row("B2", "B", "", rank=2, points=5),
    ]

    seed_pool = build_seed_pool(direct_qualifiers, [], ["goal_diff", "goals_for"])
    pairings, warnings = build_first_round_pairings(seed_pool, 4)

    assert warnings == []
    assert all(home is not None and away is not None for home, away in pairings)
    assert all(home["group_rank"] == 1 and away["group_rank"] == 2 for home, away in pairings)
