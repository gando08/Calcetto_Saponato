import uuid

from sqlalchemy import Boolean, Column, ForeignKey, String
from sqlalchemy.orm import relationship

from app.database import Base


class Player(Base):
    __tablename__ = "players"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False)
    name = Column(String, nullable=False)

    team = relationship("Team", back_populates="players")


class GoalEvent(Base):
    __tablename__ = "goal_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    match_id = Column(String, ForeignKey("matches.id"), nullable=False)
    player_id = Column(String, ForeignKey("players.id"), nullable=True)
    player_name_free = Column(String, nullable=True)
    is_own_goal = Column(Boolean, default=False)
    attributed_to_team_id = Column(String, ForeignKey("teams.id"), nullable=False)

    match = relationship("Match", back_populates="goals")
    player = relationship("Player")
