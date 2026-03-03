import uuid

from sqlalchemy import Boolean, Column, ForeignKey, String
from sqlalchemy.orm import relationship

from app.database import Base


class Day(Base):
    __tablename__ = "days"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    date = Column(String, nullable=False)
    label = Column(String, nullable=False)
    is_finals_day = Column(Boolean, default=False)
    time_windows = Column(String, nullable=False, default="[]")

    tournament = relationship("Tournament", back_populates="days")
    slots = relationship("Slot", back_populates="day", cascade="all, delete-orphan")


class Slot(Base):
    __tablename__ = "slots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    day_id = Column(String, ForeignKey("days.id"), nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    is_occupied = Column(Boolean, default=False)

    day = relationship("Day", back_populates="slots")
    match = relationship("Match", back_populates="slot", uselist=False)
