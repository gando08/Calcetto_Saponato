from itertools import combinations
from typing import Any, List, Tuple


def generate_round_robin(teams: List[Any]) -> List[Tuple[Any, Any]]:
    return list(combinations(teams, 2))
