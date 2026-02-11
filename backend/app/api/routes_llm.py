from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.services.gemini_planner import GeminiPlanner
from app.services.sim_adapter import SimAdapter
from app.services.governance_engine import GovernanceEngine
from app.policies.rules_python import evaluate_policies, GEOFENCE
from app.schemas.governance import ActionProposal
from app.utils.hashing import sha256_canonical
from app.utils.time import utc_now

logger = logging.getLogger("app.routes_llm")

router = APIRouter(prefix="/llm", tags=["llm"])


class PlanRequest(BaseModel):
    instruction: str = Field(..., description="Natural-language instruction for the robot")
    goal: Optional[Dict[str, float]] = Field(None, description="Optional {x, y} goal coordinate")


class ExecuteRequest(BaseModel):
    instruction: str = Field(..., description="The original instruction")
    waypoints: List[Dict[str, float]] = Field(..., description="Waypoints to execute [{x, y, max_speed}, ...]")
    rationale: str = Field("", description="Plan rationale from Gemini")


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


class ExecutionStep(BaseModel):
    waypoint_index: int
    waypoint: Dict[str, float]
    governance_decision: str
    policy_state: str
    policy_hits: List[str]
    executed: bool
    sim_result: Optional[Dict[str, Any]] = None
    telemetry_after: Optional[Dict[str, Any]] = None


class ExecuteResponse(BaseModel):
    status: str  # "completed" | "blocked" | "partial"
    instruction: str
    rationale: str
    steps: List[ExecutionStep]
    audit_hash: str


_sim = SimAdapter()
_gov = GovernanceEngine()
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


@router.post("/execute", response_model=ExecuteResponse)
async def execute_plan(body: ExecuteRequest):
    """Execute an LLM-generated plan: send each waypoint to the simulator
    sequentially, validating governance at each step, and building a
    tamper-proof audit trail.

    This is the key flow: NL instruction → Gemini plan → governance → sim execution → audit.
    """
    steps: List[ExecutionStep] = []
    overall_status = "completed"
    audit_records: List[Dict[str, Any]] = []

    for idx, wp in enumerate(body.waypoints):
        # Get fresh telemetry before each waypoint
        try:
            telemetry = await _sim.get_telemetry()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Simulator unreachable: {e}")

        # Build proposal
        proposal = ActionProposal(
            intent="MOVE_TO",
            params={"x": float(wp["x"]), "y": float(wp["y"]), "max_speed": float(wp.get("max_speed", 0.5))},
            rationale=f"Waypoint {idx + 1}: LLM plan for '{body.instruction}'",
        )

        # Governance evaluation
        gov = _gov.evaluate(telemetry, proposal)

        step = ExecutionStep(
            waypoint_index=idx,
            waypoint=wp,
            governance_decision=gov.decision,
            policy_state=gov.policy_state,
            policy_hits=gov.policy_hits,
            executed=False,
            sim_result=None,
            telemetry_after=None,
        )

        # Audit record
        audit_records.append({
            "ts": utc_now().isoformat(),
            "waypoint_index": idx,
            "proposal": proposal.model_dump(),
            "governance": gov.model_dump(),
        })

        if gov.decision == "APPROVED":
            # Execute on simulator
            cmd = {"intent": "MOVE_TO", "params": proposal.params}
            try:
                result = await _sim.send_command(cmd)
                step.executed = True
                step.sim_result = result
            except Exception as e:
                step.sim_result = {"error": str(e)}
                overall_status = "partial"

            # Wait for robot to move toward waypoint (short settle time)
            await asyncio.sleep(0.5)

            # Capture post-execution telemetry
            try:
                step.telemetry_after = await _sim.get_telemetry()
            except Exception:
                pass
        else:
            # Governance blocked this waypoint
            overall_status = "blocked" if idx == 0 else "partial"
            steps.append(step)
            break  # Stop at first blocked waypoint

        steps.append(step)

    # Build audit hash for the entire execution
    audit_payload = {
        "instruction": body.instruction,
        "rationale": body.rationale,
        "steps": [s.model_dump() for s in steps],
        "status": overall_status,
    }
    audit_hash = sha256_canonical(audit_payload)

    return ExecuteResponse(
        status=overall_status,
        instruction=body.instruction,
        rationale=body.rationale,
        steps=steps,
        audit_hash=audit_hash,
    )
