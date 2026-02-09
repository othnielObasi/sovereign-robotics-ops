from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db
from app.db.models import Run, Event, Mission
from app.schemas.run import RunOut, RunStartResponse
from app.schemas.events import EventOut
from app.services.run_service import RunService

router = APIRouter()
run_svc: RunService | None = None


def get_run_svc() -> RunService:
    assert run_svc is not None, "RunService not initialized"
    return run_svc


@router.post("/missions/{mission_id}/start", response_model=RunStartResponse)
async def start_run(mission_id: str, db: Session = Depends(get_db)):
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    svc = get_run_svc()
    run = svc.start_run(db, mission_id)
    return RunStartResponse(run_id=run.id)


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunOut(
        id=run.id,
        mission_id=run.mission_id,
        status=run.status,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str, db: Session = Depends(get_db)):
    svc = get_run_svc()
    await svc.stop_run(db, run_id)
    return {"ok": True}


@router.get("/runs/{run_id}/events", response_model=list[EventOut])
def list_events(run_id: str, db: Session = Depends(get_db)):
    rows = db.query(Event).filter(Event.run_id == run_id).order_by(Event.ts.asc()).all()
    out: list[EventOut] = []
    for r in rows:
        out.append(EventOut(
            id=r.id,
            run_id=r.run_id,
            ts=r.ts,
            type=r.type,
            payload=json.loads(r.payload_json),
            hash=r.hash,
        ))
    return out
