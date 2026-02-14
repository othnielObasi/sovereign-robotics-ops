from __future__ import annotations

import asyncio
import json
import logging
import math
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.db.models import Run, Event
from app.schemas.governance import ActionProposal
from app.services.sim_adapter import SimAdapter
from app.services.agent_service import AgentRouter
from app.services.governance_engine import GovernanceEngine
from app.services.telemetry_service import TelemetryService
from app.utils.ids import new_id
from app.utils.time import utc_now
from app.utils.hashing import sha256_canonical

logger = logging.getLogger("app.run_service")


class RunService:
    """Owns run lifecycle and the runtime loop.

    For MVP, we keep state in-process:
    - Each run gets an asyncio Task that polls sim telemetry,
      proposes actions, applies governance, executes if allowed,
      stores chain-of-trust events, and broadcasts updates.
    """
@@ -105,144 +106,176 @@ class RunService:
        existing = self._tasks.get(run_id)
        if existing and not existing.done():
            return  # already alive
        logger.info("Auto-resuming stale run loop for %s", run_id)
        self._launch_loop(run_id)

    async def stop_run(self, db: Session, run_id: str) -> None:
        if run_id in self._stop_flags:
            self._stop_flags[run_id].set()

        run = db.query(Run).filter(Run.id == run_id).first()
        if run and run.status == "running":
            run.status = "stopped"
            run.ended_at = utc_now()
            db.commit()

        if self._ws_broadcast:
            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "stopped"}})

    async def _run_loop(self, run_id: str) -> None:
        # IMPORTANT: DB sessions are not thread-safe; create per loop.
        from app.db.session import SessionLocal
        from app.db.models import Mission

        last_governance: Optional[Dict[str, Any]] = None
        prev_goal_distance: Optional[float] = None
        stagnant_cycles = 0

        logger.info("Run loop started: %s", run_id)
        try:
            while True:
                # stop?
                if self._stop_flags.get(run_id) and self._stop_flags[run_id].is_set():
                    break

                db = SessionLocal()
                try:
                    run = db.query(Run).filter(Run.id == run_id).first()
                    if not run or run.status != "running":
                        break
                    mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
                    goal = json.loads(mission.goal_json) if mission else {"x": 0, "y": 0}

                    telemetry = await self.sim.get_telemetry()

                    # Progress tracking for stagnation alerts
                    tx, ty = float(telemetry.get("x", 0.0)), float(telemetry.get("y", 0.0))
                    gx, gy = float(goal.get("x", tx)), float(goal.get("y", ty))
                    goal_distance = math.hypot(gx - tx, gy - ty)

                    # Store telemetry sample
                    self.tel.add_sample(db, run_id, telemetry)

                    # Stream telemetry
                    if self._ws_broadcast:
                        await self._ws_broadcast(run_id, {"kind": "telemetry", "data": telemetry})

                    # Simple alerting (MVP): forward simulator events
                    sim_events = telemetry.get("events") or []
                    for e in sim_events:
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "alert", "data": {"event": e}})

                    # Agent proposes action
                    nl_task = mission.title if mission else "Navigate to goal"
                    # Pass world state for agentic mode
                    world_state = None
                    try:
                        world_state = await self.sim.get_world()
                    except Exception:
                        pass
                    proposal: ActionProposal = await self.agent.propose(telemetry, goal, nl_task, last_governance, world_state)
                    proposal_payload = proposal.model_dump()

                    # Governance evaluates
                    gov_decision = self.gov.evaluate(telemetry, proposal)
                    gov_payload = gov_decision.model_dump()

                    # Chain-of-trust event (decision)
                    decision_event_payload = {
                        "context": {
                            "telemetry": telemetry,
                            "mission_goal": goal,
                        },
                        "proposal": proposal_payload,
                        "governance": gov_payload,
                    }

                    self._append_event(db, run_id, "DECISION", decision_event_payload)

                    # If approved, execute
                    execution = None
                    was_executed = False
                    execution_reason = "blocked_by_policy"
                    if gov_decision.decision == "APPROVED":
                        cmd = {"intent": proposal.intent, "params": proposal.params}
                        execution = await self.sim.send_command(cmd)
                        exec_payload = {"command": cmd, "result": execution}
                        self._append_event(db, run_id, "EXECUTION", exec_payload)
                        was_executed = True
                        execution_reason = "executed"

                    # Record outcome in agent memory (agentic mode)
                    self.agent.record_outcome(proposal, gov_decision, was_executed)

                    # Stagnation detection (real-world diagnostics)
                    if prev_goal_distance is not None:
                        progress = prev_goal_distance - goal_distance
                        if was_executed and progress < 0.02 and goal_distance > 0.4:
                            stagnant_cycles += 1
                        elif progress > 0.02:
                            stagnant_cycles = 0
                    prev_goal_distance = goal_distance

                    if stagnant_cycles >= 30:
                        stagnant_payload = {
                            "reason": "stagnation_detected",
                            "distance_to_goal": round(goal_distance, 3),
                            "stagnant_cycles": stagnant_cycles,
                        }
                        self._append_event(db, run_id, "STAGNATION", stagnant_payload)
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "alert", "data": stagnant_payload})
                        stagnant_cycles = 0

                    # Commit events/telemetry
                    db.commit()

                    # Broadcast event summary to UI
                    if self._ws_broadcast:
                        # Broadcast agent reasoning chain (agentic mode)
                        thought_chain = self.agent.last_thought_chain
                        if thought_chain:
                            await self._ws_broadcast(run_id, {
                                "kind": "agent_reasoning",
                                "data": {
                                    "steps": thought_chain,
                                    "total_steps": len(thought_chain),
                                },
                            })

                        await self._ws_broadcast(run_id, {
                            "kind": "event",
                            "data": {
                                "type": "DECISION",
                                "proposal": proposal_payload,
                                "governance": gov_payload,
                                "execution": execution,
                                "execution_reason": execution_reason,
                                "distance_to_goal": round(goal_distance, 3),
                                "stagnant_cycles": stagnant_cycles,
                                "policy_state": gov_payload.get("policy_state", "SAFE"),
                            }
                        })

                    last_governance = gov_payload

                    # If STOP was approved, complete run
                    if proposal.intent == "STOP" and gov_decision.decision == "APPROVED":
                        run.status = "completed"
                        run.ended_at = utc_now()
                        # Also mark the parent mission as completed
                        if mission:
                            mission.status = "completed"
                        db.commit()
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "completed"}})
                        break

                finally:
                    db.close()

                await asyncio.sleep(0.1)

        except Exception as e:
            logger.exception("Run loop crashed: %s", e)
