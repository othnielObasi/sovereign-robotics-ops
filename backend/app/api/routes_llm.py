from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.services.gemini_planner import GeminiPlanner
from app.services.sim_adapter import SimAdapter
from app.policies.rules_python import evaluate_policies, GEOFENCE
from app.schemas.governance import ActionProposal

logger = logging.getLogger("app.routes_llm")

router = APIRouter(prefix="/llm", tags=["llm"])


class PlanRequest(BaseModel):
    instruction: str = Field(..., description="Natural-language instruction for the robot")
    goal: Optional[Dict[str, float]] = Field(None, description="Optional {x, y} goal coordinate")


class Waypoint(BaseModel):
    x: float
    y: float
    max_speed: float


class WaypointPolicy(BaseModel):
    waypoint_index: int
    decision: str
    policy_hits: List[str]
    reasons: List[str]
    policy_state: str


class PlanResponse(BaseModel):
    waypoints: List[Waypoint]
    rationale: str
    estimated_time_s: float
    governance: List[WaypointPolicy]
    all_approved: bool


_sim = SimAdapter()
_planner: Optional[GeminiPlanner] = None


def _get_planner() -> GeminiPlanner:
    global _planner
    if _planner is None:
        _planner = GeminiPlanner()
    return _planner


@router.post("/plan", response_model=PlanResponse)
async def generate_plan(body: PlanRequest):
    """Generate a multi-waypoint plan via Gemini and validate every waypoint
    against governance policies.

    Returns the plan, rationale, and per-waypoint governance results.
    """
    if not settings.gemini_configured:
        raise HTTPException(
            status_code=503,
            detail="Gemini is not configured. Set GEMINI_API_KEY and GEMINI_ENABLED=true.",
        )

    # Get current telemetry for context
    try:
        telemetry = await _sim.get_telemetry()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach simulator: {e}")

    planner = _get_planner()
    try:
        plan = await planner.generate_plan(telemetry, body.instruction, body.goal)
    except Exception as e:
        logger.exception("Gemini plan generation failed")
        raise HTTPException(status_code=502, detail=f"Gemini plan generation failed: {e}")

    waypoints = plan.get("waypoints", [])
    rationale = plan.get("rationale", "")
    estimated_time_s = plan.get("estimated_time_s", 0)

    # Validate each waypoint against governance policies
    governance_results: List[WaypointPolicy] = []
    all_approved = True

    for idx, wp in enumerate(waypoints):
        proposal = ActionProposal(
            intent="MOVE_TO",
            params={"x": wp["x"], "y": wp["y"], "max_speed": wp["max_speed"]},
            rationale=f"Waypoint {idx + 1} of generated plan",
        )
        decision = evaluate_policies(telemetry, proposal)
        gov_result = WaypointPolicy(
            waypoint_index=idx,
            decision=decision.decision,
            policy_hits=decision.policy_hits,
            reasons=decision.reasons,
            policy_state=decision.policy_state,
        )
        governance_results.append(gov_result)
        if decision.decision != "APPROVED":
            all_approved = False

    return PlanResponse(
        waypoints=[Waypoint(**wp) for wp in waypoints],
        rationale=rationale,
        estimated_time_s=estimated_time_s,
        governance=governance_results,
        all_approved=all_approved,
    )
