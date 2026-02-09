from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db
from app.services.mission_service import MissionService
from app.schemas.mission import MissionCreate, MissionOut

router = APIRouter()
svc = MissionService()


@router.post("/missions", response_model=MissionOut)
def create_mission(payload: MissionCreate, db: Session = Depends(get_db)):
    m = svc.create(db, payload)
    return MissionOut(
        id=m.id,
        title=m.title,
        goal=json.loads(m.goal_json),
        created_at=m.created_at,
    )


@router.get("/missions", response_model=list[MissionOut])
def list_missions(db: Session = Depends(get_db)):
    missions = svc.list(db)
    out = []
    for m in missions:
        out.append(MissionOut(id=m.id, title=m.title, goal=json.loads(m.goal_json), created_at=m.created_at))
    return out


@router.get("/missions/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, db: Session = Depends(get_db)):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="mission not found")
    return MissionOut(id=m.id, title=m.title, goal=json.loads(m.goal_json), created_at=m.created_at)
