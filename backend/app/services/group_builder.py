import math
from typing import Dict, List


def compute_overlap_score(team_a: Dict, team_b: Dict, all_slots: List[str]) -> float:
    unavail_a = set(team_a.get("unavailable_slot_ids", []))
    unavail_b = set(team_b.get("unavailable_slot_ids", []))
    available_a = set(all_slots) - unavail_a
    available_b = set(all_slots) - unavail_b

    if not all_slots:
        return 1.0

    overlap = len(available_a & available_b)
    return overlap / len(all_slots)


def build_groups(teams: List[Dict], teams_per_group: int, all_slot_ids: List[str]) -> List[List[Dict]]:
    n_groups = math.ceil(len(teams) / teams_per_group)
    groups: List[List[Dict]] = [[] for _ in range(n_groups)]

    sorted_teams = sorted(
        teams,
        key=lambda team: len(team.get("unavailable_slot_ids", [])),
        reverse=True,
    )

    for team in sorted_teams:
        best_group = 0
        best_score = -1.0
        for i, group in enumerate(groups):
            if len(group) >= teams_per_group:
                continue
            if not group:
                score = 0.5
            else:
                scores = [compute_overlap_score(team, member, all_slot_ids) for member in group]
                score = sum(scores) / len(scores)
            if score > best_score:
                best_score = score
                best_group = i
        groups[best_group].append(team)

    return [group for group in groups if group]


def build_compatibility_matrix(teams: List[Dict], all_slot_ids: List[str]) -> Dict:
    matrix: Dict = {}
    for team in teams:
        matrix[team["id"]] = {}
        for other in teams:
            if team["id"] != other["id"]:
                matrix[team["id"]][other["id"]] = round(
                    compute_overlap_score(team, other, all_slot_ids) * 100,
                    1,
                )
    return matrix
