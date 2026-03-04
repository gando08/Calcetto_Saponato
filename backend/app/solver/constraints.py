from typing import Dict, List, Set


def check_hard_constraints(match: Dict, slot: Dict, teams_unavail: Dict[str, Set[str]]) -> bool:
    slot_id = slot["id"]
    home_id = match.get("team_home_id")
    away_id = match.get("team_away_id")

    if home_id and slot_id in teams_unavail.get(home_id, set()):
        return False
    if away_id and slot_id in teams_unavail.get(away_id, set()):
        return False
    return True


def compute_soft_penalty(
    match: Dict,
    slot: Dict,
    slot_index: int,
    total_slots: int,
    team_schedules: Dict[str, List[int]],
    team_prefs: Dict[str, Dict],
    weights: Dict[str, int],
) -> int:
    penalty = 0

    for team_id in [match.get("team_home_id"), match.get("team_away_id")]:
        if not team_id:
            continue
        prefs = team_prefs.get(team_id, {})

        if prefs.get("preferred_days") and slot.get("day_id") not in prefs["preferred_days"]:
            penalty += weights.get("pref_day_violation", 10)

        if prefs.get("preferred_time_windows"):
            in_window = any(
                window["start"] <= slot["start_time"] < window["end"]
                for window in prefs["preferred_time_windows"]
            )
            if not in_window:
                penalty += weights.get("pref_window_violation", 8)

        schedule = team_schedules.get(team_id, [])
    
    position = slot_index / max(total_slots - 1, 1)
    if position == 0.0 or position == 1.0:
        penalty += weights.get("equity_imbalance", 3)

    return penalty
