from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import datetime as dt


class MissionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    goal: Dict[str, Any] = Field(..., description="Goal object, e.g. {'x': 15, 'y': 7}")


class MissionUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    goal: Optional[Dict[str, Any]] = None


class MissionOut(BaseModel):
    id: str
    title: str
    goal: Dict[str, Any]
    status: str = "draft"
    created_at: dt.datetime
    updated_at: Optional[dt.datetime] = None
