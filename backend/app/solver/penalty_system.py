from typing import Dict

DEFAULT_WEIGHTS = {
    "pref_day_violation": 10,
    "pref_window_violation": 8,
    "consecutive_penalty": 5,
    "rest_violation": 15,
    "equity_imbalance": 3,
    "finals_day_preference": 20,
}


class PenaltySystem:
    def __init__(self, weights: Dict[str, int] | None = None):
        self.weights = {**DEFAULT_WEIGHTS, **(weights or {})}
        self._violations: Dict[str, int] = {key: 0 for key in self.weights}

    def record(self, violation_type: str, count: int = 1) -> None:
        if violation_type in self._violations:
            self._violations[violation_type] += count

    def total(self) -> int:
        return sum(self.weights.get(key, 0) * value for key, value in self._violations.items())

    def report(self) -> Dict:
        result: Dict = {}
        total = 0
        for key, count in self._violations.items():
            penalty = self.weights.get(key, 0) * count
            result[key] = {"count": count, "penalty": penalty}
            total += penalty
        result["total"] = total
        return result

    def reset(self) -> None:
        self._violations = {key: 0 for key in self.weights}
