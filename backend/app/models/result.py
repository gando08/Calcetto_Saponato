import uuid

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Result(Base):
    __tablename__ = "results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    match_id = Column(String, ForeignKey("matches.id"), unique=True, nullable=False)
    goals_home = Column(Integer, default=0)
    goals_away = Column(Integer, default=0)
    yellow_home = Column(Integer, default=0)
    yellow_away = Column(Integer, default=0)
    red_home = Column(Integer, default=0)
    red_away = Column(Integer, default=0)
    delay_home = Column(Integer, default=0)  # 0 or 1
    delay_away = Column(Integer, default=0)  # 0 or 1

    match = relationship("Match", back_populates="result")
