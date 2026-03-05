from typing import Dict, List

from app.solver.sa_group_builder import SAGroupBuilder


def compute_overlap_score(team_a: Dict, team_b: Dict, all_slots: List[str]) -> float:
    unavail_a = set(team_a.get("unavailable_slot_ids", []))
    unavail_b = set(team_b.get("unavailable_slot_ids", []))
    available_a = set(all_slots) - unavail_a
    available_b = set(all_slots) - unavail_b

    if not all_slots:
        return 1.0

    overlap = len(available_a & available_b)
    return overlap / len(all_slots)


def build_groups(
    teams: List[Dict], teams_per_group: int, all_slot_ids: List[str]
) -> List[List[Dict]]:
    """Build groups via Simulated Annealing + LNS (maximises intra-group slot compatibility)."""
    return SAGroupBuilder().build_groups(teams, teams_per_group, all_slot_ids)


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
