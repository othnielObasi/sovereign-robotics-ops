from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from app.deps import get_db
from app.db.models import Run, Event, Mission, TelemetrySample
from app.schemas.run import RunOut, RunStartResponse
from app.schemas.events import EventOut
from app.services.run_service import RunService

router = APIRouter()
run_svc: RunService | None = None


def get_run_svc() -> RunService:
    assert run_svc is not None, "RunService not initialized"
    return run_svc


# --- Backward-compatible endpoint ---
# Old frontend builds call POST /runs with {"mission_id": "..."}
class _LegacyRunStart(BaseModel):
    mission_id: str


@router.post("/runs", response_model=RunStartResponse)
async def start_run_legacy(body: _LegacyRunStart, db: Session = Depends(get_db)):
    """Backward-compatible: accepts POST /runs {mission_id} and proxies to the
    canonical /missions/{id}/start handler."""
    return await start_run(body.mission_id, db)


@router.post("/missions/{mission_id}/start", response_model=RunStartResponse)
async def start_run(mission_id: str, db: Session = Depends(get_db)):
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    svc = get_run_svc()
    run = svc.start_run(db, mission_id)
    return RunStartResponse(run_id=run.id)


@router.get("/runs", response_model=List[RunOut])
def list_runs(
    mission_id: Optional[str] = Query(None, description="Filter by mission ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Run)
    if mission_id:
        q = q.filter(Run.mission_id == mission_id)
    if status:
        q = q.filter(Run.status == status)
    rows = q.order_by(Run.started_at.desc()).offset(offset).limit(limit).all()
    return [
        RunOut(id=r.id, mission_id=r.mission_id, status=r.status, started_at=r.started_at, ended_at=r.ended_at)
        for r in rows
    ]


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


@router.get("/runs/{run_id}/events", response_model=List[EventOut])
def list_events(
    run_id: str,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Event)
        .filter(Event.run_id == run_id)
        .order_by(Event.ts.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        EventOut(
            id=r.id,
            run_id=r.run_id,
            ts=r.ts,
            type=r.type,
            payload=json.loads(r.payload_json),
            hash=r.hash,
            prev_hash=r.prev_hash or "0" * 64,
        )
        for r in rows
    ]


@router.get("/runs/{run_id}/telemetry")
def list_telemetry(
    run_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TelemetrySample)
        .filter(TelemetrySample.run_id == run_id)
        .order_by(TelemetrySample.ts.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {"id": r.id, "run_id": r.run_id, "ts": r.ts.isoformat(), "payload": json.loads(r.payload_json)}
        for r in rows
    ]
