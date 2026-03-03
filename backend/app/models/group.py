import enum
import uuid

from sqlalchemy import Column, Enum as SAEnum, ForeignKey, String, Table
from sqlalchemy.orm import relationship

from app.database import Base


class GroupPhase(str, enum.Enum):
    GROUP = "group"
    FINAL = "final"


group_teams = Table(
    "group_teams",
    Base.metadata,
    Column("group_id", String, ForeignKey("groups.id")),
    Column("team_id", String, ForeignKey("teams.id")),
)


class Group(Base):
    __tablename__ = "groups"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tournament_id = Column(String, ForeignKey("tournaments.id"), nullable=False)
    name = Column(String, nullable=False)
    gender = Column(SAEnum("M", "F", name="gender_enum2"), nullable=False)
    phase = Column(SAEnum(GroupPhase), default=GroupPhase.GROUP)

    tournament = relationship("Tournament", back_populates="groups")
    teams = relationship("Team", secondary=group_teams)
    matches = relationship("Match", back_populates="group", cascade="all, delete-orphan")
