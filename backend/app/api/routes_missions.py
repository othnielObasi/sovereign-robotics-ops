from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from app.deps import get_db
from app.auth.jwt import get_current_user
from app.services.mission_service import MissionService
from app.schemas.mission import MissionCreate, MissionUpdate, MissionOut

router = APIRouter()
svc = MissionService()


def _to_out(m) -> MissionOut:
    return MissionOut(
        id=m.id,
        title=m.title,
        goal=json.loads(m.goal_json),
        status=getattr(m, "status", "draft") or "draft",
        created_at=m.created_at,
        updated_at=getattr(m, "updated_at", None),
    )


@router.post("/missions", response_model=MissionOut)
def create_mission(
    payload: MissionCreate,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.create(db, payload)
    return _to_out(m)


@router.get("/missions", response_model=List[MissionOut])
def list_missions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    missions = svc.list(db, limit=limit, offset=offset)
    return [_to_out(m) for m in missions]


@router.get("/missions/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, db: Session = Depends(get_db)):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="mission not found")
    return _to_out(m)


@router.patch("/missions/{mission_id}", response_model=MissionOut)
def update_mission(
    mission_id: str,
    payload: MissionUpdate,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.update(db, mission_id, payload)
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found or not editable (must be draft/paused)")
    return _to_out(m)


@router.post("/missions/{mission_id}/pause", response_model=MissionOut)
def pause_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found")
    if m.status not in ("draft", "executing"):
        raise HTTPException(status_code=400, detail=f"Cannot pause mission in '{m.status}' state")
    m = svc.set_status(db, mission_id, "paused")
    return _to_out(m)


@router.post("/missions/{mission_id}/resume", response_model=MissionOut)
def resume_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found")
    if m.status != "paused":
        raise HTTPException(status_code=400, detail="Can only resume paused missions")
    m = svc.set_status(db, mission_id, "draft")
    return _to_out(m)


@router.delete("/missions/{mission_id}")
def delete_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    m = svc.get(db, mission_id)
    if not m:
        raise HTTPException(status_code=404, detail="mission not found")
    svc.soft_delete(db, mission_id)
    return {"ok": True, "deleted": mission_id}
