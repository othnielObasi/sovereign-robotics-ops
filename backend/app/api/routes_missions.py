from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from app.deps import get_db
from app.auth.jwt import get_current_user
from app.services.mission_service import MissionService
from app.schemas.mission import MissionCreate, MissionOut

router = APIRouter()
svc = MissionService()


@router.post("/missions", response_model=MissionOut)
def create_mission(
    payload: MissionCreate,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.create(db, payload)
    return MissionOut(
        id=m.id,
        title=m.title,
        goal=json.loads(m.goal_json),
        created_at=m.created_at,
    )


@router.get("/missions", response_model=List[MissionOut])
def list_missions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    missions = svc.list(db, limit=limit, offset=offset)
    return [
        MissionOut(id=m.id, title=m.title, goal=json.loads(m.goal_json), created_at=m.created_at)
        for m in missions
    ]


@router.get("/missions/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, db: Session = Depends(get_db)):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="mission not found")
    return MissionOut(id=m.id, title=m.title, goal=json.loads(m.goal_json), created_at=m.created_at)


@router.delete("/missions/{mission_id}")
def delete_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="mission not found")
    db.delete(m)
    db.commit()
    return {"ok": True, "deleted": mission_id}
