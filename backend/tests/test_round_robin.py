from app.services.round_robin import generate_round_robin


def test_4_teams_produces_6_matches() -> None:
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    assert len(matches) == 6


def test_no_team_plays_itself() -> None:
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    for home, away in matches:
        assert home != away


def test_no_duplicate_matches() -> None:
    teams = ["A", "B", "C", "D"]
    matches = generate_round_robin(teams)
    pairs = set()
    for home, away in matches:
        pair = frozenset([home, away])
        assert pair not in pairs
        pairs.add(pair)


def test_2_teams_produces_1_match() -> None:
    matches = generate_round_robin(["A", "B"])
    assert len(matches) == 1


def test_3_teams_produces_3_matches() -> None:
    matches = generate_round_robin(["A", "B", "C"])
    assert len(matches) == 3


def test_formula_n_choose_2() -> None:
    for n in range(2, 9):
        teams = [str(i) for i in range(n)]
        matches = generate_round_robin(teams)
        expected = n * (n - 1) // 2
        assert len(matches) == expected
