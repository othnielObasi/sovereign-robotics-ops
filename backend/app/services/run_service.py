from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.db.models import Run, Event
from app.schemas.governance import ActionProposal
from app.services.sim_adapter import SimAdapter
from app.services.agent_service import AgentRouter
from app.services.governance_engine import GovernanceEngine
from app.services.telemetry_service import TelemetryService
from app.policies.rules_python import ZONE_SPEED_LIMITS
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

    def __init__(self):
        self._tasks: Dict[str, asyncio.Task] = {}
        self._stop_flags: Dict[str, asyncio.Event] = {}
        self._ws_broadcast = None  # injected by WS manager
        self._plans: Dict[str, List[Dict[str, Any]]] = {}

        self.sim = SimAdapter()
        self.agent = AgentRouter()
        self.gov = GovernanceEngine()
        self.tel = TelemetryService()

    def bind_broadcaster(self, broadcaster):
        self._ws_broadcast = broadcaster

    def rehydrate_plans(self, db: Session) -> None:
        """Load last PLAN event per running run from the DB into the in-memory plans store.

        This allows the service to resume following a persisted plan after a restart.
        """
        try:
            # Find latest PLAN event per run (order by ts asc and overwrite so last wins)
            rows = (
                db.query(Event)
                .filter(Event.type == "PLAN")
                .order_by(Event.ts.asc())
                .all()
            )
            for r in rows:
                try:
                    payload = json.loads(r.payload_json)
                    plan = payload.get("plan") if isinstance(payload, dict) else None
                    if plan and plan.get("waypoints"):
                        self._plans[r.run_id] = plan.get("waypoints")
                except Exception:
                    # ignore malformed plan payloads
                    pass
        except Exception:
            # Non-fatal; continue without plans
            return

    def _append_event(self, db: Session, run_id: str, etype: str, payload: Dict[str, Any]) -> Event:
        # Get previous event hash for chain linking
        prev = (
            db.query(Event)
            .filter(Event.run_id == run_id)
            .order_by(Event.ts.desc())
            .first()
        )
        prev_hash = prev.hash if prev else "0" * 64

        ts = utc_now()  # single timestamp for both hash and storage
        evt = {
            "run_id": run_id,
            "ts": ts.isoformat(),
            "type": etype,
            "payload": payload,
            "prev_hash": prev_hash,
        }
        evt_hash = sha256_canonical(evt)
        row = Event(
            id=new_id("evt"),
            run_id=run_id,
            ts=ts,
            type=etype,
            payload_json=json.dumps(payload, ensure_ascii=False),
            hash=evt_hash,
            prev_hash=prev_hash,
        )
        db.add(row)
        return row

    def start_run(self, db: Session, mission_id: str) -> Run:
        run = Run(
            id=new_id("run"),
            mission_id=mission_id,
            status="running",
            started_at=utc_now(),
            ended_at=None,
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # launch loop; plan may be attached later via self._plans[run.id]
        self._launch_loop(run.id)
        return run

    def _launch_loop(self, run_id: str) -> None:
        """Spawn the asyncio run-loop task for a given run."""
        if run_id in self._tasks and not self._tasks[run_id].done():
            return  # already running
        stop_event = asyncio.Event()
        self._stop_flags[run_id] = stop_event
        self._tasks[run_id] = asyncio.create_task(self._run_loop(run_id))
        logger.info("Launched run loop task for %s", run_id)

    def ensure_loop_running(self, run_id: str, db_status: str) -> None:
        """If the run is 'running' in DB but has no active asyncio task,
        re-launch the loop.  This handles process restarts / deploys."""
        if db_status != "running":
            return
        existing = self._tasks.get(run_id)
        if existing and not existing.done():
            return  # already alive
        logger.info("Auto-resuming stale run loop for %s", run_id)
        self._launch_loop(run_id)

    def rehydrate_plans(self, db: Session) -> None:
        """Load persisted PLAN events from DB for runs and populate in-memory plans.

        Expects a SQLAlchemy `Session` (this allows caller to control transactions).
        """
        try:
            # Find runs that are currently running
            runs = db.query(Run).filter(Run.status == "running").all()
            for r in runs:
                # Find most recent PLAN event for this run
                plan_evt = (
                    db.query(Event)
                    .filter(Event.run_id == r.id)
                    .filter(Event.type == "PLAN")
                    .order_by(Event.ts.desc())
                    .first()
                )
                if plan_evt:
                    try:
                        payload = json.loads(plan_evt.payload_json)
                        plan = payload.get("plan") or {}
                        waypoints = plan.get("waypoints") or []
                        if waypoints:
                            self._plans[r.id] = waypoints.copy()
                            logger.info("Rehydrated plan for run %s (%d waypoints)", r.id, len(waypoints))
                    except Exception:
                        logger.warning("Failed to parse PLAN event for run %s", r.id)
        except Exception as e:
            logger.warning("rehydrate_plans failed: %s", e)

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

                    # If an explicit plan exists for this run, follow it waypoint-by-waypoint.
                    proposal: ActionProposal
                    nl_task = mission.title if mission else "Navigate to goal"
                    world_state = None
                    try:
                        world_state = await self.sim.get_world()
                    except Exception:
                        pass

                    plan_wps = self._plans.get(run_id)
                    if plan_wps:
                        # Use the first waypoint as the next action
                        wp = plan_wps[0]
                        proposal = ActionProposal(
                            intent="MOVE_TO",
                            params={"x": float(wp.get("x")), "y": float(wp.get("y")), "max_speed": float(wp.get("max_speed", 0.5))},
                            rationale="Following LLM plan waypoint",
                        )
                    else:
                        # Agent proposes action (may be LLM-driven depending on settings)
                        proposal = await self.agent.propose(telemetry, goal, nl_task, last_governance, world_state)
                    # Clamp planned max_speed to zone limits to avoid trivial NEEDS_REVIEW
                    if proposal.intent == "MOVE_TO":
                        zone = telemetry.get("zone", "aisle")
                        limit = float(ZONE_SPEED_LIMITS.get(zone, 0.5))
                        p = proposal.params or {}
                        p["max_speed"] = min(float(p.get("max_speed", 0.5)), limit)
                        proposal.params = p

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
                    if gov_decision.decision == "APPROVED":
                        cmd = {"intent": proposal.intent, "params": proposal.params}
                        execution = await self.sim.send_command(cmd)
                        exec_payload = {"command": cmd, "result": execution}
                        self._append_event(db, run_id, "EXECUTION", exec_payload)
                        was_executed = True

                        # If we executed a planned waypoint, remove it from the plan
                        if plan_wps:
                            try:
                                self._plans[run_id].pop(0)
                                if not self._plans[run_id]:
                                    self._plans.pop(run_id, None)
                            except Exception:
                                pass

                    # Record outcome in agent memory (agentic mode)
                    self.agent.record_outcome(proposal, gov_decision, was_executed)

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
            # Mark run failed
            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                run = db.query(Run).filter(Run.id == run_id).first()
                if run:
                    run.status = "failed"
                    run.ended_at = utc_now()
                    db.commit()
            finally:
                db.close()
            if self._ws_broadcast:
                await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "failed"}})

        logger.info("Run loop ended: %s", run_id)
        # Cleanup finished task references
        self._tasks.pop(run_id, None)
        self._stop_flags.pop(run_id, None)
