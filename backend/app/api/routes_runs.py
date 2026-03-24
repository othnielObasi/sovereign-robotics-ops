from __future__ import annotations

import asyncio
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from app.deps import get_db
from app.auth.jwt import get_current_user
from app.db.models import Run, Event, Mission, TelemetrySample
from app.schemas.run import RunOut, RunStartResponse
from app.schemas.events import EventOut
from app.services.run_service import RunService
from app.services.gemini_planner import GeminiPlanner
from app.services.local_fallback_planner import generate_fallback_waypoint
from app.config import settings

logger = logging.getLogger("app.routes_runs")

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
async def start_run_legacy(
    body: _LegacyRunStart,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    """Backward-compatible: accepts POST /runs {mission_id} and proxies to the
    canonical /missions/{id}/start handler."""
    return await start_run(body.mission_id, db)


async def _generate_plan_background(svc: RunService, run_id: str, mission_id: str, mission_title: str, goal_json: str):
    """Background task: generate LLM plan and attach to run.

    Runs after the HTTP response has already been returned so the user
    isn't blocked waiting for LLM cascading.
    """
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        telemetry = None
        try:
            telemetry = await svc.sim.get_telemetry()
        except Exception:
            telemetry = {}

        planner = GeminiPlanner()
        plan = await planner.generate_plan(telemetry, mission_title, json.loads(goal_json))
        if plan and plan.get("waypoints"):
            svc._plans[run_id] = plan.get("waypoints")
            plan_payload = {
                "mission_id": mission_id,
                "plan": plan,
                "note": "Initial LLM multi-waypoint plan generated (background)",
            }
            svc._append_event(db, run_id, "PLAN", plan_payload)
            db.commit()
            logger.info(f"LLM plan attached to run {run_id}")
        else:
            logger.warning(f"LLM plan generation returned empty for run {run_id}")
    except Exception as exc:
        logger.warning(f"Background LLM plan generation failed for run {run_id}: {exc}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/missions/{mission_id}/start", response_model=RunStartResponse)
async def start_run(
    mission_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    if getattr(mission, "status", "draft") == "deleted":
        raise HTTPException(status_code=400, detail="Cannot start a deleted mission")
    svc = get_run_svc()

    # Create run and launch loop
    run = svc.start_run(db, mission_id)

    # Persist an immediate conservative seed plan so the run has a deterministic
    # plan record even before slower background planning completes.
    try:
        telemetry = await svc.sim.get_telemetry()
    except Exception:
        telemetry = {}

    seed_waypoint = generate_fallback_waypoint(telemetry, json.loads(mission.goal_json))
    svc._plans[run.id] = [seed_waypoint]
    svc._append_event(
        db,
        run.id,
        "PLAN",
        {
            "mission_id": mission.id,
            "plan": {"waypoints": [seed_waypoint]},
            "note": "Initial conservative fallback plan generated at run start",
        },
    )
    db.commit()

    # Fire-and-forget: generate LLM plan in background so this response
    # returns immediately.  The plan will be attached to the run once ready.
    asyncio.create_task(
        _generate_plan_background(svc, run.id, mission.id, mission.title, mission.goal_json)
    )

    # Mark mission as executing
    mission.status = "executing"
    db.commit()
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
    # Auto-resume the run loop if it was lost due to a deploy/restart
    svc = get_run_svc()
    svc.ensure_loop_running(run.id, run.status)
    return RunOut(
        id=run.id,
        mission_id=run.mission_id,
        status=run.status,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


@router.post("/runs/{run_id}/stop")
async def stop_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    svc = get_run_svc()
    await svc.stop_run(db, run_id)
    return {"ok": True}


@router.post("/runs/{run_id}/pause")
async def pause_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    """Pause a running run — robot stops executing but run can be resumed."""
    svc = get_run_svc()
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "running":
        raise HTTPException(status_code=400, detail=f"Cannot pause run in state '{run.status}'")
    await svc.pause_run(db, run_id)
    return {"ok": True, "status": "paused"}


@router.post("/runs/{run_id}/resume")
async def resume_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: str | None = Depends(get_current_user),
):
    """Resume a paused run."""
    svc = get_run_svc()
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume run in state '{run.status}'")
    await svc.resume_run(db, run_id)
    return {"ok": True, "status": "running"}


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


@router.get("/runs/{run_id}/replay")
def replay_run(
    run_id: str,
    include_telemetry: bool = Query(False, description="Include raw telemetry samples"),
    db: Session = Depends(get_db),
):
    """Return the full timeline of a run for audit replay, including chain integrity verification."""
    from app.services.replay_service import get_run_timeline

    timeline = get_run_timeline(db, run_id, include_telemetry=include_telemetry)
    if not timeline:
        raise HTTPException(status_code=404, detail="Run not found")
    return timeline


@router.get("/runs/{run_id}/audit-bundle")
def audit_bundle(
    run_id: str,
    db: Session = Depends(get_db),
):
    """Export a self-contained audit bundle for regulatory submission."""
    from app.services.replay_service import export_audit_bundle

    bundle = export_audit_bundle(db, run_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Run not found")
    return bundle


@router.get("/runs/{run_id}/scores")
def get_run_scores(
    run_id: str,
    db: Session = Depends(get_db),
):
    """Compute and return multi-objective scorecard for a run."""
    from app.services.scoring_engine import compute_scorecard

    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return compute_scorecard(db, run_id)


@router.get("/runs/{run_id}/risk-heatmap")
def get_risk_heatmap(
    run_id: str,
    grid_size: float = Query(2.0, ge=0.5, le=10.0, description="Grid cell size in meters"),
    db: Session = Depends(get_db),
):
    """Compute spatial risk heatmap from governance decisions (#21).

    Returns a grid of risk scores based on where denials and
    high-risk decisions occurred during the run.
    """
    import json as _json
    from app.db.models import GovernanceDecisionRecord
    from app.world_model import GEOFENCE

    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    decisions = (
        db.query(GovernanceDecisionRecord)
        .filter(GovernanceDecisionRecord.run_id == run_id)
        .all()
    )

    min_x = GEOFENCE["min_x"]
    max_x = GEOFENCE["max_x"]
    min_y = GEOFENCE["min_y"]
    max_y = GEOFENCE["max_y"]

    # Build grid
    cols = int((max_x - min_x) / grid_size) + 1
    rows = int((max_y - min_y) / grid_size) + 1
    grid = [[0.0] * cols for _ in range(rows)]
    counts = [[0] * cols for _ in range(rows)]

    for d in decisions:
        try:
            tel = _json.loads(d.telemetry_summary or "{}")
            x = float(tel.get("x", 0))
            y = float(tel.get("y", 0))
            col = int((x - min_x) / grid_size)
            row = int((y - min_y) / grid_size)
            if 0 <= row < rows and 0 <= col < cols:
                # Weight: denials=1.0, needs_review=0.7, approved=0.1
                weight = 1.0 if d.decision == "DENIED" else (0.7 if d.decision == "NEEDS_REVIEW" else 0.1)
                grid[row][col] += d.risk_score * weight
                counts[row][col] += 1
        except Exception:
            continue

    # Normalize to 0-1
    max_val = max(max(row) for row in grid) if grid else 1.0
    if max_val > 0:
        grid = [[cell / max_val for cell in row] for row in grid]

    # Build cell list for frontend
    cells = []
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] > 0.05:  # skip near-zero cells
                cells.append({
                    "x": round(min_x + c * grid_size, 1),
                    "y": round(min_y + r * grid_size, 1),
                    "risk": round(grid[r][c], 3),
                    "decisions": counts[r][c],
                })

    return {
        "run_id": run_id,
        "grid_size": grid_size,
        "bounds": {"min_x": min_x, "max_x": max_x, "min_y": min_y, "max_y": max_y},
        "cells": cells,
        "total_decisions": len(decisions),
    }


@router.get("/runs/{run_id}/introspection")
def get_run_introspection(
    run_id: str,
    db: Session = Depends(get_db),
):
    """Agent introspection: thought chains, denial history, memory recalls (#20)."""
    import json as _json

    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Gather DECISION events for thought chain
    decision_events = (
        db.query(Event)
        .filter(Event.run_id == run_id, Event.type == "DECISION")
        .order_by(Event.ts.asc())
        .all()
    )

    # Gather REPLAN events
    replan_events = (
        db.query(Event)
        .filter(Event.run_id == run_id, Event.type == "REPLAN")
        .order_by(Event.ts.asc())
        .all()
    )

    # Gather PLAN events
    plan_events = (
        db.query(Event)
        .filter(Event.run_id == run_id, Event.type == "PLAN")
        .order_by(Event.ts.asc())
        .all()
    )

    # Build denial history
    from app.db.models import GovernanceDecisionRecord
    denials = (
        db.query(GovernanceDecisionRecord)
        .filter(
            GovernanceDecisionRecord.run_id == run_id,
            GovernanceDecisionRecord.decision.in_(["DENIED", "NEEDS_REVIEW"]),
        )
        .order_by(GovernanceDecisionRecord.ts.asc())
        .all()
    )

    denial_history = []
    for d in denials:
        denial_history.append({
            "ts": d.ts.isoformat() if d.ts else None,
            "decision": d.decision,
            "policy_hits": _json.loads(d.policy_hits or "[]"),
            "reasons": _json.loads(d.reasons or "[]"),
            "risk_score": d.risk_score,
            "policy_state": d.policy_state,
        })

    # Memory context
    try:
        from app.services.persistent_memory import PersistentMemory
        mem = PersistentMemory()
        memory_context = mem.recall_for_context(db)
        memory_stats = mem.get_stats(db)
    except Exception:
        memory_context = "Memory unavailable"
        memory_stats = {}

    return {
        "run_id": run_id,
        "total_decisions": len(decision_events),
        "total_replans": len(replan_events),
        "total_plans": len(plan_events),
        "denial_count": len(denials),
        "denial_history": denial_history[:50],
        "replans": [
            {
                "ts": e.ts.isoformat() if e.ts else None,
                "payload": _json.loads(e.payload_json),
            }
            for e in replan_events
        ],
        "plans": [
            {
                "ts": e.ts.isoformat() if e.ts else None,
                "payload": _json.loads(e.payload_json),
            }
            for e in plan_events
        ],
        "memory_context": memory_context,
        "memory_stats": memory_stats,
    }
