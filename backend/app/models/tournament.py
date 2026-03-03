import enum
import uuid

from sqlalchemy import JSON, Boolean, Column, Enum as SAEnum, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class TournamentStatus(str, enum.Enum):
    SETUP = "setup"
    GROUPS = "groups"
    SCHEDULED = "scheduled"
    ONGOING = "ongoing"
    FINISHED = "finished"


class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    status = Column(SAEnum(TournamentStatus), default=TournamentStatus.SETUP)
    total_days = Column(Integer, default=4)
    match_duration_minutes = Column(Integer, default=30)
    buffer_minutes = Column(Integer, default=0)
    teams_per_group = Column(Integer, default=4)
    teams_advancing_per_group = Column(Integer, default=2)
    wildcard_enabled = Column(Boolean, default=False)
    wildcard_count = Column(Integer, default=0)
    points_win = Column(Integer, default=3)
    points_draw = Column(Integer, default=1)
    points_loss = Column(Integer, default=0)
    tiebreaker_order = Column(
        JSON,
        default=lambda: [
            "head_to_head",
            "goal_diff",
            "goals_for",
            "goals_against",
            "fair_play",
            "draw",
        ],
    )
    penalty_weights = Column(
        JSON,
        default=lambda: {
            "pref_day_violation": 10,
            "pref_window_violation": 8,
            "consecutive_penalty": 5,
            "rest_violation": 15,
            "equity_imbalance": 3,
            "finals_day_preference": 20,
        },
    )

    days = relationship("Day", back_populates="tournament", cascade="all, delete-orphan")
    teams = relationship("Team", back_populates="tournament", cascade="all, delete-orphan")
    groups = relationship("Group", back_populates="tournament", cascade="all, delete-orphan")
