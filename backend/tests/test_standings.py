from app.services.standings_calculator import calculate_standings

MATCHES = [
    {"home": "A", "away": "B", "goals_home": 3, "goals_away": 1, "yellow_home": 0, "yellow_away": 1},
    {"home": "A", "away": "C", "goals_home": 2, "goals_away": 2, "yellow_home": 0, "yellow_away": 0},
    {"home": "B", "away": "C", "goals_home": 0, "goals_away": 1, "yellow_home": 2, "yellow_away": 0},
]
CONFIG = {"points_win": 3, "points_draw": 1, "points_loss": 0}
TIEBREAKERS = ["head_to_head", "goal_diff", "goals_for", "goals_against", "fair_play"]


def test_points_calculated_correctly() -> None:
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    points = {row["team"]: row["points"] for row in standings}
    assert points["A"] == 4
    assert points["B"] == 0
    assert points["C"] == 4


def test_standings_ordered_by_points() -> None:
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    assert standings[2]["team"] == "B"


def test_goal_diff_calculated() -> None:
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    row_a = next(r for r in standings if r["team"] == "A")
    assert row_a["goal_diff"] == 2


def test_all_fields_present() -> None:
    standings = calculate_standings(["A", "B", "C"], MATCHES, CONFIG, TIEBREAKERS)
    required = {"team", "played", "won", "drawn", "lost", "goals_for", "goals_against", "goal_diff", "points", "yellow_cards"}
    assert required.issubset(set(standings[0].keys()))
