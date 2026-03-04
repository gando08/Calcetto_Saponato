import pytest

from app.services.qualification_service import QualificationError, select_finalists

TIEBREAKERS = ["head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play"]


def _row(
    team: str,
    points: int,
    goal_diff: int,
    goals_for: int,
    goals_against: int,
    yellow_cards: int,
    *,
    drawn: int = 0,
    head_to_head: int = 0,
) -> dict:
    return {
        "team": team,
        "points": points,
        "goal_diff": goal_diff,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "yellow_cards": yellow_cards,
        "drawn": drawn,
        "head_to_head": head_to_head,
    }


def _group(name: str, standings: list[dict], *, played: bool = True) -> dict:
    status = "played" if played else "pending"
    return {"name": name, "standings": standings, "matches": [{"status": status}]}


def test_requires_group_phase_closed_before_generating_finals() -> None:
    groups = [
        _group("A", [_row("A1", 6, 3, 5, 2, 1), _row("A2", 3, -1, 2, 3, 1)], played=False),
        _group("B", [_row("B1", 6, 2, 4, 2, 0), _row("B2", 3, -2, 1, 3, 0)]),
    ]

    with pytest.raises(QualificationError, match="Group phase is not closed"):
        select_finalists(groups, "M", TIEBREAKERS)


def test_group_phase_closed_when_status_missing_but_goals_present() -> None:
    groups = [
        {
            "name": "A",
            "standings": [
                _row("A1", 9, 5, 7, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
            ],
            "matches": [{"goals_home": 2, "goals_away": 1}],
        },
        {
            "name": "B",
            "standings": [
                _row("B1", 8, 4, 6, 2, 0),
                _row("B2", 5, 1, 4, 3, 1),
            ],
            "matches": [{"goals_home": 1, "goals_away": 1}],
        },
    ]

    selection = select_finalists(groups, "F", TIEBREAKERS)

    assert selection["target_size"] == 4
    assert [row["team"] for row in selection["qualified_teams"]] == ["A1", "A2", "B1", "B2"]


def test_selects_top_two_per_group_as_direct_qualifiers_for_female() -> None:
    groups = [
        _group(
            "A",
            [
                _row("A1", 9, 5, 7, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
                _row("A3", 3, -2, 2, 4, 2),
            ],
        ),
        _group(
            "B",
            [
                _row("B1", 8, 4, 6, 2, 0),
                _row("B2", 5, 1, 4, 3, 1),
                _row("B3", 2, -3, 1, 4, 3),
            ],
        ),
    ]

    selection = select_finalists(groups, "F", TIEBREAKERS)

    assert selection["target_size"] == 4
    assert [row["team"] for row in selection["direct_qualifiers"]] == ["A1", "A2", "B1", "B2"]
    assert selection["wildcards"] == []
    assert [row["team"] for row in selection["qualified_teams"]] == ["A1", "A2", "B1", "B2"]


def test_male_target_stays_eight_when_direct_qualifiers_equal_eight() -> None:
    groups = [
        _group("A", [_row("A1", 6, 3, 4, 1, 0), _row("A2", 3, 0, 2, 2, 1)]),
        _group("B", [_row("B1", 6, 3, 4, 1, 0), _row("B2", 3, 0, 2, 2, 1)]),
        _group("C", [_row("C1", 6, 3, 4, 1, 0), _row("C2", 3, 0, 2, 2, 1)]),
        _group("D", [_row("D1", 6, 3, 4, 1, 0), _row("D2", 3, 0, 2, 2, 1)]),
    ]

    selection = select_finalists(groups, "M", TIEBREAKERS)

    assert selection["target_size"] == 8
    assert len(selection["direct_qualifiers"]) == 8
    assert selection["wildcards"] == []
    assert len(selection["qualified_teams"]) == 8


def test_male_target_switches_to_sixteen_when_direct_exceeds_eight() -> None:
    groups = []
    for idx in range(1, 6):
        groups.append(
            _group(
                f"G{idx}",
                [
                    _row(f"G{idx}T1", 9, 5, 7, 2, 0),
                    _row(f"G{idx}T2", 7, 2, 5, 3, 1),
                    _row(f"G{idx}T3", 5 + idx, 1, 4, 3, 2),
                    _row(f"G{idx}T4", 1, -4, 1, 5, 3),
                ],
            )
        )

    selection = select_finalists(groups, "M", TIEBREAKERS)

    assert selection["target_size"] == 16
    assert len(selection["direct_qualifiers"]) == 10
    assert len(selection["wildcards"]) == 6
    assert len(selection["qualified_teams"]) == 16


def test_female_raises_when_direct_qualifiers_exceed_four() -> None:
    groups = [
        _group("A", [_row("A1", 6, 3, 4, 1, 0), _row("A2", 3, 0, 2, 2, 1)]),
        _group("B", [_row("B1", 6, 3, 4, 1, 0), _row("B2", 3, 0, 2, 2, 1)]),
        _group("C", [_row("C1", 6, 3, 4, 1, 0), _row("C2", 3, 0, 2, 2, 1)]),
    ]

    with pytest.raises(QualificationError, match="Female finals can have at most 4 direct qualifiers"):
        select_finalists(groups, "F", TIEBREAKERS)


def test_wildcard_ranking_excludes_head_to_head_criterion() -> None:
    groups = [
        _group(
            "A",
            [
                _row("A1", 9, 4, 6, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
                _row("A3", 4, 1, 4, 3, 2, head_to_head=0),
                _row("A4", 4, 0, 2, 2, 0, head_to_head=100),
            ],
        ),
        _group(
            "B",
            [
                _row("B1", 9, 4, 6, 2, 0),
                _row("B2", 6, 2, 5, 3, 1),
                _row("B3", 4, 2, 4, 2, 4, head_to_head=0),
            ],
        ),
        _group(
            "C",
            [
                _row("C1", 9, 4, 6, 2, 0),
                _row("C2", 6, 2, 5, 3, 1),
                _row("C3", 5, 0, 3, 3, 2, head_to_head=0),
            ],
        ),
    ]

    selection = select_finalists(groups, "M", TIEBREAKERS)
    wildcard_teams = [row["team"] for row in selection["wildcards"]]

    assert wildcard_teams == ["C3", "B3"]
    assert "A4" not in wildcard_teams


def test_raises_when_not_enough_wildcards_to_fill_target() -> None:
    groups = [
        _group("A", [_row("A1", 6, 3, 4, 1, 0), _row("A2", 3, 0, 2, 2, 1)]),
        _group("B", [_row("B1", 6, 3, 4, 1, 0), _row("B2", 3, 0, 2, 2, 1)]),
        _group("C", [_row("C1", 6, 3, 4, 1, 0), _row("C2", 3, 0, 2, 2, 1)]),
    ]

    with pytest.raises(QualificationError, match="Not enough wildcard candidates to fill finals"):
        select_finalists(groups, "M", TIEBREAKERS)


def test_raises_for_unsupported_gender() -> None:
    groups = [
        _group("A", [_row("A1", 6, 3, 4, 1, 0), _row("A2", 3, 0, 2, 2, 1)]),
    ]

    with pytest.raises(QualificationError, match="Unsupported gender"):
        select_finalists(groups, "X", TIEBREAKERS)


def test_male_raises_when_direct_qualifiers_exceed_sixteen() -> None:
    groups = []
    for idx in range(1, 10):
        groups.append(
            _group(
                f"G{idx}",
                [
                    _row(f"G{idx}T1", 9, 5, 7, 2, 0),
                    _row(f"G{idx}T2", 6, 2, 5, 3, 1),
                    _row(f"G{idx}T3", 3, -1, 2, 3, 2),
                ],
            )
        )

    with pytest.raises(QualificationError, match="Too many direct qualifiers"):
        select_finalists(groups, "M", TIEBREAKERS)


def test_raises_on_unknown_tiebreaker_criterion() -> None:
    groups = [
        _group(
            "A",
            [
                _row("A1", 9, 5, 7, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
                _row("A3", 4, 1, 4, 3, 2),
            ],
        ),
        _group(
            "B",
            [
                _row("B1", 9, 5, 7, 2, 0),
                _row("B2", 6, 2, 5, 3, 1),
                _row("B3", 4, 1, 4, 3, 2),
            ],
        ),
        _group(
            "C",
            [
                _row("C1", 9, 5, 7, 2, 0),
                _row("C2", 6, 2, 5, 3, 1),
                _row("C3", 4, 1, 4, 3, 2),
            ],
        ),
    ]

    with pytest.raises(QualificationError, match="Unsupported tiebreaker criterion"):
        select_finalists(groups, "M", [*TIEBREAKERS, "unknown_metric"])


def test_raises_on_invalid_numeric_stat_for_wildcard_ranking() -> None:
    groups = [
        _group(
            "A",
            [
                _row("A1", 9, 5, 7, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
                _row("A3", 4, 1, 4, 3, 2),
            ],
        ),
        _group(
            "B",
            [
                _row("B1", 9, 5, 7, 2, 0),
                _row("B2", 6, 2, 5, 3, 1),
                {
                    "team": "B3",
                    "points": 4,
                    "goal_diff": "bad-value",
                    "goals_for": 4,
                    "goals_against": 3,
                    "yellow_cards": 2,
                },
            ],
        ),
        _group(
            "C",
            [
                _row("C1", 9, 5, 7, 2, 0),
                _row("C2", 6, 2, 5, 3, 1),
                _row("C3", 4, 1, 4, 3, 2),
            ],
        ),
    ]

    with pytest.raises(QualificationError, match="Invalid numeric stat"):
        select_finalists(groups, "M", TIEBREAKERS)


def test_wildcard_ranking_uses_draw_tiebreaker_mapped_to_drawn_field() -> None:
    groups = [
        _group(
            "A",
            [
                _row("A1", 9, 5, 7, 2, 0),
                _row("A2", 6, 2, 5, 3, 1),
                _row("A3", 4, 1, 4, 3, 2, drawn=3),
            ],
        ),
        _group(
            "B",
            [
                _row("B1", 9, 5, 7, 2, 0),
                _row("B2", 6, 2, 5, 3, 1),
                _row("B3", 4, 1, 4, 3, 2, drawn=2),
            ],
        ),
        _group(
            "C",
            [
                _row("C1", 9, 5, 7, 2, 0),
                _row("C2", 6, 2, 5, 3, 1),
                _row("C3", 4, 1, 4, 3, 2, drawn=1),
            ],
        ),
    ]

    selection = select_finalists(groups, "M", ["head_to_head", "draw"])
    wildcard_teams = [row["team"] for row in selection["wildcards"]]

    assert wildcard_teams == ["A3", "B3"]
