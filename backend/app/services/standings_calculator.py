from typing import Dict, List


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


def apply_tiebreakers(standings: List[Dict], matches: List[Dict], order: List[str], config: Dict) -> List[Dict]:
    del matches
    del config

    def sort_key(row: Dict) -> List[int]:
        keys: List[int] = []
        for criterion in order:
            if criterion == "goal_diff":
                keys.append(-row["goal_diff"])
            elif criterion == "goals_for":
                keys.append(-row["goals_for"])
            elif criterion == "goals_against":
                keys.append(row["goals_against"])
            elif criterion == "fair_play":
                # Fair play: penalizziamo gialli, rossi (pesano 3) e ritardi (pesano 5)
                # PiÃ¹ basso Ã¨ il valore, meglio Ã¨.
                fair_play_score = row["yellow_cards"] + (row["red_cards"] * 3) + (row["delays"] * 5)
                keys.append(fair_play_score)
            else:
                keys.append(0)
        return [-row["points"], *keys]

    return sorted(standings, key=sort_key)
