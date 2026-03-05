from typing import Dict, List, Tuple


def calculate_standings(
    teams: List[str],
    matches: List[Dict],
    config: Dict,
    tiebreaker_order: List[str],
) -> List[Dict]:
    rows = {
        team: {
            "team": team,
            "played": 0,
            "won": 0,
            "drawn": 0,
            "lost": 0,
            "goals_for": 0,
            "goals_against": 0,
            "goal_diff": 0,
            "points": 0,
            "yellow_cards": 0,
            "red_cards": 0,
            "delays": 0,
        }
        for team in teams
    }

    for match in matches:
        home = match["home"]
        away = match["away"]
        goals_home = match["goals_home"]
        goals_away = match["goals_away"]

        # Fix #7: skip matches whose teams are not in this group's standings table.
        if home not in rows or away not in rows:
            continue

        rows[home]["played"] += 1
        rows[away]["played"] += 1
        rows[home]["goals_for"] += goals_home
        rows[home]["goals_against"] += goals_away
        rows[away]["goals_for"] += goals_away
        rows[away]["goals_against"] += goals_home
        rows[home]["yellow_cards"] += match.get("yellow_home", 0)
        rows[away]["yellow_cards"] += match.get("yellow_away", 0)
        rows[home]["red_cards"] += match.get("red_home", 0)
        rows[away]["red_cards"] += match.get("red_away", 0)
        rows[home]["delays"] += match.get("delay_home", 0)
        rows[away]["delays"] += match.get("delay_away", 0)

        if goals_home > goals_away:
            rows[home]["won"] += 1
            rows[home]["points"] += config["points_win"]
            rows[away]["lost"] += 1
            rows[away]["points"] += config["points_loss"]
        elif goals_home < goals_away:
            rows[away]["won"] += 1
            rows[away]["points"] += config["points_win"]
            rows[home]["lost"] += 1
            rows[home]["points"] += config["points_loss"]
        else:
            rows[home]["drawn"] += 1
            rows[away]["drawn"] += 1
            rows[home]["points"] += config["points_draw"]
            rows[away]["points"] += config["points_draw"]

    for row in rows.values():
        row["goal_diff"] = row["goals_for"] - row["goals_against"]

    return apply_tiebreakers(list(rows.values()), matches, tiebreaker_order, config)


# Fix #8: implement head_to_head and draw tiebreakers; previously both fell
# through to `else: keys.append(0)` and had no effect on ordering.

def _compute_h2h(
    matches: List[Dict], config: Dict
) -> Dict[Tuple[str, str], Dict]:
    """
    Build a lookup of head-to-head results between every pair of teams.
    h2h[(team_a, team_b)] = {points, goal_diff, goals_for}  from team_a's perspective.
    """
    h2h: Dict[Tuple[str, str], Dict] = {}

    def _add(team: str, opp: str, pts: int, gf: int, ga: int) -> None:
        key = (team, opp)
        if key not in h2h:
            h2h[key] = {"points": 0, "goal_diff": 0, "goals_for": 0}
        h2h[key]["points"] += pts
        h2h[key]["goal_diff"] += gf - ga
        h2h[key]["goals_for"] += gf

    for m in matches:
        home, away = m.get("home"), m.get("away")
        if not home or not away:
            continue
        gh, ga = m.get("goals_home", 0), m.get("goals_away", 0)
        if gh > ga:
            _add(home, away, config.get("points_win", 3), gh, ga)
            _add(away, home, config.get("points_loss", 0), ga, gh)
        elif ga > gh:
            _add(away, home, config.get("points_win", 3), ga, gh)
            _add(home, away, config.get("points_loss", 0), gh, ga)
        else:
            draw_pts = config.get("points_draw", 1)
            _add(home, away, draw_pts, gh, ga)
            _add(away, home, draw_pts, ga, gh)

    return h2h


def apply_tiebreakers(
    standings: List[Dict], matches: List[Dict], order: List[str], config: Dict
) -> List[Dict]:
    # Pre-compute head-to-head table only when needed.
    use_h2h = "head_to_head" in order
    h2h = _compute_h2h(matches, config) if use_h2h else {}

    # Map team → points for quick lookup when computing h2h sub-tables.
    points_map = {r["team"]: r["points"] for r in standings}

    def sort_key(row: Dict) -> List:
        team = row["team"]
        pts = row["points"]
        keys: List = [-pts]

        for criterion in order:
            if criterion == "goal_diff":
                keys.append(-row["goal_diff"])
            elif criterion == "goals_for":
                keys.append(-row["goals_for"])
            elif criterion == "goals_against":
                keys.append(row["goals_against"])
            elif criterion == "fair_play":
                # Lower is better: yellow=1, red=3, delay=5
                fp = row["yellow_cards"] + row["red_cards"] * 3 + row["delays"] * 5
                keys.append(fp)
            elif criterion == "draw":
                keys.append(-row["drawn"])
            elif criterion == "head_to_head":
                # Compare only against teams that are tied on total points.
                rivals = [t for t, p in points_map.items() if p == pts and t != team]
                h2h_pts = sum(h2h.get((team, r), {}).get("points", 0) for r in rivals)
                h2h_gd = sum(h2h.get((team, r), {}).get("goal_diff", 0) for r in rivals)
                h2h_gf = sum(h2h.get((team, r), {}).get("goals_for", 0) for r in rivals)
                keys.extend([-h2h_pts, -h2h_gd, -h2h_gf])
            # unknown criteria are silently ignored (future-proof)

        return keys

    return sorted(standings, key=sort_key)
