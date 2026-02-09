from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class Point(BaseModel):
    x: float
    y: float


class CircleObstacle(BaseModel):
    x: float
    y: float
    r: float


class Geofence(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


class ZoneRect(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float


class Zone(BaseModel):
    name: str
    rect: ZoneRect


class Human(BaseModel):
    x: float
    y: float


class SimWorld(BaseModel):
    geofence: Geofence
    zones: List[Zone] = []
    obstacles: List[Dict[str, Any]] = []  # kept flexible for MVP
    human: Optional[Human] = None


class PathPreview(BaseModel):
    points: List[Point]
    note: str = ""
