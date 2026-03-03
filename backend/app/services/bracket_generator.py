import math
from typing import Dict, List


def generate_bracket(
    advancing_teams: List[Dict],
    wildcard_teams: List[Dict],
    groups: List[Dict],
    gender: str,
) -> List[Dict]:
    del groups
    all_seeds = _seed_teams(advancing_teams, wildcard_teams)
    n_teams = len(all_seeds)
    bracket_size = _next_power_of_2(n_teams)
    matches: List[Dict] = []

    current_round: List[Dict] = []
    for i in range(bracket_size // 2):
        home_idx = i
        away_idx = bracket_size - 1 - i
        home = all_seeds[home_idx] if home_idx < len(all_seeds) else None
        away = all_seeds[away_idx] if away_idx < len(all_seeds) else None
        match = {
            "phase": _phase_name(bracket_size),
            "round": 1,
            "gender": gender,
            "team_home_id": home["id"] if home else None,
            "team_away_id": away["id"] if away else None,
            "placeholder_home": home["name"] if home else f"Bye {home_idx + 1}",
            "placeholder_away": away["name"] if away else f"Bye {away_idx + 1}",
            "bracket_position": i,
        }
        current_round.append(match)
        matches.append(match)

    round_num = 2
    while len(current_round) > 1:
        next_round: List[Dict] = []
        for i in range(0, len(current_round), 2):
            match = {
                "phase": _phase_name(len(current_round) // 2),
                "round": round_num,
                "gender": gender,
                "team_home_id": None,
                "team_away_id": None,
                "placeholder_home": f"Vincitore Match {i + 1}",
                "placeholder_away": f"Vincitore Match {i + 2}",
                "bracket_position": i // 2,
                "prerequisite_positions": [i, i + 1],
            }
            next_round.append(match)
            matches.append(match)
        current_round = next_round
        round_num += 1

    matches.append(
        {
            "phase": "third",
            "round": round_num - 1,
            "gender": gender,
            "team_home_id": None,
            "team_away_id": None,
            "placeholder_home": "Perdente Semifinale 1",
            "placeholder_away": "Perdente Semifinale 2",
            "bracket_position": 99,
        }
    )
    return matches


def _next_power_of_2(n: int) -> int:
    return 2 ** math.ceil(math.log2(max(n, 2)))


def _phase_name(size: int) -> str:
    return {1: "final", 2: "semi", 4: "quarter"}.get(size, "round")


def _seed_teams(advancing: List[Dict], wildcards: List[Dict]) -> List[Dict]:
    seeded: List[Dict] = []
    firsts = [team for team in advancing if team.get("rank") == 1]
    seconds = [team for team in advancing if team.get("rank") == 2]

    for team in firsts:
        seeded.append(team)
    for team in reversed(seconds):
        seeded.append(team)

    seeded.extend(wildcards)
    return seeded
