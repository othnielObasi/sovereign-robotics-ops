from __future__ import annotations

import json
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_db
from app.db.models import Run, Mission
from app.schemas.sim import SimWorld, PathPreview, Point
from app.services.sim_adapter import SimAdapter
from app.services.path_planner import plan_path

router = APIRouter()
sim = SimAdapter()


@router.get("/sim/world", response_model=SimWorld)
async def get_world():
    """Proxy the simulator's world definition (geofence, obstacles, human)."""
    try:
        return await sim.get_world()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"sim error: {e}")


@router.get("/runs/{run_id}/path_preview", response_model=PathPreview)
async def path_preview(run_id: str, db: Session = Depends(get_db)):
    """Return a path polyline from latest pose to mission goal."""
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="mission not found")

    goal = json.loads(mission.goal_json)
    telemetry = await sim.get_telemetry()

    world = await sim.get_world()
    points, note = plan_path(
        start={"x": float(telemetry.get("x", 0)), "y": float(telemetry.get("y", 0))},
        goal={"x": float(goal.get("x", 0)), "y": float(goal.get("y", 0))},
        obstacles=world.get("obstacles", []),
        clearance_m=0.75,
    )
    return PathPreview(points=[Point(**p) for p in points], note=note)
