import enum
import uuid

from sqlalchemy import Boolean, Column, Enum as SAEnum, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class MatchPhase(str, enum.Enum):
    GROUP = "group"
    ROUND16 = "round16"
    QUARTER = "quarter"
    SEMI = "semi"
    THIRD = "third"
    FINAL = "final"


class MatchStatus(str, enum.Enum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    PLAYED = "played"


class Match(Base):
    __tablename__ = "matches"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = Column(String, ForeignKey("groups.id"), nullable=False)
    slot_id = Column(String, ForeignKey("slots.id"), nullable=True)
    team_home_id = Column(String, ForeignKey("teams.id"), nullable=True)
    team_away_id = Column(String, ForeignKey("teams.id"), nullable=True)
    placeholder_home = Column(String, nullable=True)
    placeholder_away = Column(String, nullable=True)
    phase = Column(SAEnum(MatchPhase), default=MatchPhase.GROUP)
    round = Column(Integer, default=0)
    status = Column(SAEnum(MatchStatus), default=MatchStatus.PENDING)
    is_manually_locked = Column(Boolean, default=False)
    prerequisite_match_home_id = Column(String, ForeignKey("matches.id"), nullable=True)
    prerequisite_match_away_id = Column(String, ForeignKey("matches.id"), nullable=True)

    group = relationship("Group", back_populates="matches")
    slot = relationship("Slot", back_populates="match")
    team_home = relationship("Team", foreign_keys=[team_home_id])
    team_away = relationship("Team", foreign_keys=[team_away_id])
    result = relationship(
        "Result",
        back_populates="match",
        uselist=False,
        cascade="all, delete-orphan",
    )
    goals = relationship("GoalEvent", back_populates="match", cascade="all, delete-orphan")
