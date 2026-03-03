from typing import Dict, List, Optional

from pydantic import BaseModel


class TeamCreate(BaseModel):
    name: str
    gender: str
    preferred_days: List[str] = []
    preferred_time_windows: List[Dict[str, str]] = []
    unavailable_slot_ids: List[str] = []
    prefers_consecutive: bool = False


class TeamUpdate(TeamCreate):
    name: Optional[str] = None
    gender: Optional[str] = None


class TeamResponse(TeamCreate):
    id: str
    tournament_id: str

    class Config:
        from_attributes = True
