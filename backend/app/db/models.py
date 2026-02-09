from __future__ import annotations

from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.db.session import Base


class Mission(Base):
    __tablename__ = "missions"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    goal_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)

    runs = relationship("Run", back_populates="mission", cascade="all, delete-orphan")


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, index=True)
    mission_id = Column(String, ForeignKey("missions.id"), nullable=False)
    status = Column(String, nullable=False)  # running|stopped|completed|failed
    started_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    mission = relationship("Mission", back_populates="runs")
    events = relationship("Event", back_populates="run", cascade="all, delete-orphan")


class Event(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("runs.id"), nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False)
    type = Column(String, nullable=False)  # TELEMETRY|DECISION|ALERT
    payload_json = Column(Text, nullable=False)
    hash = Column(String, nullable=False)

    run = relationship("Run", back_populates="events")


class TelemetrySample(Base):
    __tablename__ = "telemetry_samples"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, index=True, nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False)
    payload_json = Column(Text, nullable=False)
