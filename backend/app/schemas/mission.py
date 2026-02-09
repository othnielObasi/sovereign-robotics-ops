from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Dict, Any
import datetime as dt


class MissionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    goal: Dict[str, Any] = Field(..., description="Goal object, e.g. {'x': 15, 'y': 7}")


class MissionOut(BaseModel):
    id: str
    title: str
    goal: Dict[str, Any]
    created_at: dt.datetime
