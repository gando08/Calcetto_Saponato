import enum
import uuid

from sqlalchemy import JSON, Boolean, Column, Enum as SAEnum, ForeignKey, String
from sqlalchemy.orm import relationship

from app.database import Base


class Gender(str, enum.Enum):
    M = "M"
    F = "F"


class Team(Base):
    __tablename__ = "teams"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    name = Column(String, nullable=False)
    gender = Column(SAEnum(Gender), nullable=False)
    preferred_days = Column(JSON, default=list)
    preferred_time_windows = Column(JSON, default=list)
    unavailable_slot_ids = Column(JSON, default=list)
    prefers_consecutive = Column(Boolean, default=False)

    tournament = relationship("Tournament", back_populates="teams")
    players = relationship("Player", back_populates="team", cascade="all, delete-orphan")
