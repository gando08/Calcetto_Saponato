from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class TournamentCreate(BaseModel):
    name: str
    total_days: int = 4
    match_duration_minutes: int = 30
    buffer_minutes: int = 0
    teams_per_group: int = 4
    teams_advancing_per_group: int = 2
    wildcard_enabled: bool = False
    wildcard_count: int = 0
    points_win: int = 3
    points_draw: int = 1
    points_loss: int = 0
    tiebreaker_order: List[str] = [
        "head_to_head",
        "goal_diff",
        "goals_for",
        "goals_against",
        "fair_play",
        "draw",
    ]
    penalty_weights: Dict[str, int] = {}
    gender: Optional[str] = None       # "M", "F", or None
    max_teams: Optional[int] = None    # None = no limit


class TournamentUpdate(TournamentCreate):
    name: Optional[str] = None


class DayCreate(BaseModel):
    date: str
    label: str
    is_finals_day: bool = False
    time_windows: List[Dict[str, str]]


class TournamentResponse(TournamentCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
