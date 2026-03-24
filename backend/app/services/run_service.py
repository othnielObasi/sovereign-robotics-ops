from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.models import Run, Event
from app.schemas.governance import ActionProposal
from app.services.sim_adapter import SimAdapter
from app.services.agent_service import AgentRouter
from app.services.governance_engine import GovernanceEngine
from app.services.telemetry_service import TelemetryService
from app.world_model import ZONE_SPEED_LIMITS
from app.utils.ids import new_id
from app.utils.time import utc_now
from app.utils.hashing import sha256_canonical

logger = logging.getLogger("app.run_service")


class RunService:
    """Owns run lifecycle and the runtime loop.

    Supports: start, stop, pause, resume for intervention control.
    Records every governance decision to the governance_decisions table.
    """

    def __init__(self):
        self._tasks: Dict[str, asyncio.Task] = {}
        self._stop_flags: Dict[str, asyncio.Event] = {}
        self._pause_flags: Dict[str, asyncio.Event] = {}  # set = paused
        self._ws_broadcast = None  # injected by WS manager
        self._plans: Dict[str, List[Dict[str, Any]]] = {}

        # Diagnostics state per run
        self._last_positions: Dict[str, tuple[float, float]] = {}
        self._stagnant_counts: Dict[str, int] = {}
        self.STAGNATION_THRESHOLD_M = 0.02  # movement below this counts as stagnant
        self.STAGNATION_CYCLES = 10

        # Replan-on-denial: track consecutive denials of the current waypoint
        self._wp_denial_counts: Dict[str, int] = {}
        self.REPLAN_DENIAL_THRESHOLD = 5  # re-plan after N consecutive denials

        # Executed path tracking: actual positions visited per run
        self._executed_paths: Dict[str, List[Dict[str, Any]]] = {}

        self.sim = SimAdapter()
        self.agent = AgentRouter()
        self.gov = GovernanceEngine()
        self.tel = TelemetryService()

    def bind_broadcaster(self, broadcaster):
        self._ws_broadcast = broadcaster

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
        # Snapshot policy version at run start (#16)
        from app.policies.versioning import policy_version_hash, policy_version_info
        from app.db.models import PolicyVersion
        import json as _json

        pv_hash = policy_version_hash()
        pv_info = policy_version_info()

        # Upsert policy version record
        existing_pv = db.query(PolicyVersion).filter(PolicyVersion.version_hash == pv_hash).first()
        if not existing_pv:
            pv_row = PolicyVersion(
                version_hash=pv_hash,
                parameters_json=_json.dumps(pv_info["parameters"], sort_keys=True),
                created_at=utc_now(),
                description=f"Auto-snapshot at run start",
            )
            db.add(pv_row)

        run = Run(
            id=new_id("run"),
            mission_id=mission_id,
            status="running",
            started_at=utc_now(),
            ended_at=None,
            policy_version=pv_hash,
            planning_mode="llm_with_fallback",
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
                    except (TypeError, ValueError, json.JSONDecodeError) as exc:
                        logger.warning("Failed to parse PLAN event for run %s: %s", r.id, exc)
        except Exception as e:
            logger.warning("rehydrate_plans failed: %s", e)

    async def stop_run(self, db: Session, run_id: str) -> None:
        if run_id in self._stop_flags:
            self._stop_flags[run_id].set()

        run = db.query(Run).filter(Run.id == run_id).first()
        if run and run.status in ("running", "paused"):
            run.status = "stopped"
            run.ended_at = utc_now()
            db.commit()

        # Log INTERVENTION event
        self._append_event(db, run_id, "INTERVENTION", {
            "type": "STOP",
            "actor": "operator",
            "reason": "Manual stop requested",
        })
        db.commit()

        if self._ws_broadcast:
            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "stopped"}})

    async def pause_run(self, db: Session, run_id: str) -> None:
        """Pause a running run — loop continues but stops executing actions."""
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run or run.status != "running":
            return

        if run_id not in self._pause_flags:
            self._pause_flags[run_id] = asyncio.Event()
        self._pause_flags[run_id].set()  # set = paused

        run.status = "paused"
        db.commit()

        # Send STOP to simulator
        try:
            await self.sim.send_command({"intent": "STOP", "params": {}})
        except Exception:
            pass

        self._append_event(db, run_id, "INTERVENTION", {
            "type": "PAUSE",
            "actor": "operator",
            "reason": "Run paused by operator",
        })
        db.commit()

        if self._ws_broadcast:
            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "paused"}})

    async def resume_run(self, db: Session, run_id: str) -> None:
        """Resume a paused run."""
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run or run.status != "paused":
            return

        run.status = "running"
        db.commit()

        # Clear pause flag
        if run_id in self._pause_flags:
            self._pause_flags[run_id].clear()

        # Re-launch loop if needed
        self._launch_loop(run_id)

        self._append_event(db, run_id, "INTERVENTION", {
            "type": "RESUME",
            "actor": "operator",
            "reason": "Run resumed by operator",
        })
        db.commit()

        if self._ws_broadcast:
            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "running"}})

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

                # paused? — sleep and re-check
                if self._pause_flags.get(run_id) and self._pause_flags[run_id].is_set():
                    await asyncio.sleep(0.5)
                    continue

                db = SessionLocal()
                try:
                    run = db.query(Run).filter(Run.id == run_id).first()
                    if not run or run.status not in ("running",):
                        break
                    mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
                    goal = json.loads(mission.goal_json) if mission else {"x": 0, "y": 0}

                    telemetry = await self.sim.get_telemetry()

                    # Store telemetry sample
                    self.tel.add_sample(db, run_id, telemetry)

                    # --- Diagnostics: distance to goal & stagnation detection ---
                    try:
                        tx, ty = float(telemetry.get("x", 0.0)), float(telemetry.get("y", 0.0))
                        gx, gy = float(goal.get("x", 0.0)), float(goal.get("y", 0.0))
                        distance_to_goal = ((tx - gx) ** 2 + (ty - gy) ** 2) ** 0.5
                    except Exception:
                        distance_to_goal = None

                    prev = self._last_positions.get(run_id)
                    moved = None
                    if prev:
                        try:
                            moved = ((tx - prev[0]) ** 2 + (ty - prev[1]) ** 2) ** 0.5
                        except Exception:
                            moved = None

                    # Update stagnant counters
                    if moved is None or moved < self.STAGNATION_THRESHOLD_M:
                        self._stagnant_counts[run_id] = self._stagnant_counts.get(run_id, 0) + 1
                    else:
                        self._stagnant_counts[run_id] = 0
                    self._last_positions[run_id] = (tx, ty)

                    stagnant_cycles = self._stagnant_counts.get(run_id, 0)
                    # Emit a STAGNATION event if we've been stagnant for too long
                    if stagnant_cycles >= self.STAGNATION_CYCLES:
                        try:
                            st_payload = {
                                "reason": "Robot movement below threshold",
                                "stagnant_cycles": stagnant_cycles,
                                "distance_to_goal": distance_to_goal,
                            }
                            self._append_event(db, run_id, "STAGNATION", st_payload)
                            if self._ws_broadcast:
                                await self._ws_broadcast(run_id, {"kind": "alert", "data": {"event": "STAGNATION", "payload": st_payload}})
                        except Exception:
                            pass

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

                    # Governance evaluates and persists decision
                    gov_decision = self.gov.evaluate_and_record(
                        db, run_id, telemetry, proposal,
                    )
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

                    decision_evt = self._append_event(db, run_id, "DECISION", decision_event_payload)

                    # If approved, execute
                    execution = None
                    was_executed = False
                    if gov_decision.decision == "APPROVED":
                        # Reset waypoint denial counter on approval
                        self._wp_denial_counts[run_id] = 0

                        cmd = {"intent": proposal.intent, "params": proposal.params}
                        execution = await self.sim.send_command(cmd)
                        exec_payload = {"command": cmd, "result": execution}
                        self._append_event(db, run_id, "EXECUTION", exec_payload)
                        was_executed = True

                        # Track executed path
                        self._executed_paths.setdefault(run_id, []).append({
                            "x": round(float(telemetry.get("x", 0)), 4),
                            "y": round(float(telemetry.get("y", 0)), 4),
                            "speed": round(float(telemetry.get("speed", 0)), 4),
                            "ts": utc_now().isoformat(),
                        })

                        # If we executed a planned waypoint, remove it from the plan
                        if plan_wps:
                            try:
                                self._plans[run_id].pop(0)
                                if not self._plans[run_id]:
                                    self._plans.pop(run_id, None)
                            except Exception:
                                pass
                    else:
                        # Denied or NEEDS_REVIEW — increment waypoint denial counter
                        self._wp_denial_counts[run_id] = self._wp_denial_counts.get(run_id, 0) + 1
                        denial_count = self._wp_denial_counts[run_id]

                        if denial_count >= self.REPLAN_DENIAL_THRESHOLD and plan_wps:
                            # Trigger replanning: discard blocked waypoint and request new plan
                            blocked_wp = plan_wps[0] if plan_wps else {}
                            logger.warning(
                                "Run %s: %d consecutive denials on waypoint %s — triggering replan",
                                run_id, denial_count, blocked_wp,
                            )
                            # Remove the blocked waypoint
                            try:
                                self._plans[run_id].pop(0)
                                if not self._plans[run_id]:
                                    self._plans.pop(run_id, None)
                            except Exception:
                                pass

                            # Record replan event in chain-of-trust
                            replan_payload = {
                                "reason": "repeated_denial",
                                "denial_count": denial_count,
                                "blocked_waypoint": blocked_wp,
                                "policy_hits": gov_decision.policy_hits,
                                "policy_state": gov_decision.policy_state,
                            }
                            self._append_event(db, run_id, "REPLAN", replan_payload)

                            # Attempt to generate a new plan via LLM
                            try:
                                denial_context = ", ".join(gov_decision.reasons) if gov_decision.reasons else "policy violation"
                                replan_instruction = (
                                    f"{nl_task}. Previous waypoint at ({blocked_wp.get('x')},{blocked_wp.get('y')}) "
                                    f"was blocked: {denial_context}. Plan an alternative route avoiding that area."
                                )
                                planner = self.agent._gemini_planner()
                                new_plan = await planner.generate_plan(telemetry, replan_instruction, goal)
                                new_wps = new_plan.get("waypoints", [])
                                if new_wps:
                                    self._plans[run_id] = new_wps
                                    replan_payload["new_plan_waypoints"] = len(new_wps)
                                    logger.info("Run %s: replanned with %d new waypoints", run_id, len(new_wps))
                            except Exception as replan_err:
                                logger.warning("Run %s: replan LLM call failed: %s", run_id, replan_err)

                            self._wp_denial_counts[run_id] = 0

                            if self._ws_broadcast:
                                await self._ws_broadcast(run_id, {
                                    "kind": "alert",
                                    "data": {"event": "REPLAN", "payload": replan_payload},
                                })

                    # Update the governance decision record with execution result and event hash
                    from app.db.models import GovernanceDecisionRecord
                    latest_gov = (
                        db.query(GovernanceDecisionRecord)
                        .filter(GovernanceDecisionRecord.run_id == run_id)
                        .order_by(GovernanceDecisionRecord.id.desc())
                        .first()
                    )
                    if latest_gov:
                        latest_gov.was_executed = "true" if was_executed else "false"
                        latest_gov.event_hash = decision_evt.hash

                    # Record outcome in agent memory (agentic mode)
                    self.agent.record_outcome(proposal, gov_decision, was_executed)

                    # Persist decision in DB-backed memory (#17)
                    try:
                        from app.services.persistent_memory import PersistentMemory
                        pmem = PersistentMemory()
                        pmem.store_decision(
                            db, run_id,
                            proposal.intent,
                            proposal.params or {},
                            gov_decision.decision,
                            gov_decision.policy_hits,
                            gov_decision.reasons,
                            was_executed,
                        )
                    except Exception:
                        pass  # non-critical

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

                        # Compute execution_reason for UI clarity
                        execution_reason = "executed" if was_executed else f"blocked:{gov_decision.decision}"

                        await self._ws_broadcast(run_id, {
                            "kind": "event",
                            "data": {
                                "type": "DECISION",
                                "proposal": proposal_payload,
                                "governance": gov_payload,
                                "execution": execution,
                                "policy_state": gov_payload.get("policy_state", "SAFE"),
                                "execution_reason": execution_reason,
                                "distance_to_goal": distance_to_goal,
                                "stagnant_cycles": stagnant_cycles,
                                "executed_path_len": len(self._executed_paths.get(run_id, [])),
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

                        # Post-run safety validation (#14)
                        try:
                            from app.services.safety_validator import validate_run_safety
                            safety = validate_run_safety(db, run.id)
                            if safety and safety.get("verdict") == "FAILED":
                                run.status = "failed_safety"
                                logger.warning("Run %s failed safety validation: %s", run.id, safety.get("violations"))
                        except Exception as sv_err:
                            logger.warning("Safety validation error for run %s: %s", run.id, sv_err)

                        # Cross-run learning aggregation (#18)
                        try:
                            from app.services.cross_run_learning import aggregate_cross_run_lessons
                            aggregate_cross_run_lessons(db)
                        except Exception:
                            pass

                        # Extract lessons from completed run (#18)
                        try:
                            from app.services.persistent_memory import PersistentMemory
                            pmem = PersistentMemory()
                            pmem.extract_lessons_from_run(db, run_id)
                        except Exception:
                            pass

                        db.commit()
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "completed"}})
                        break

                finally:
                    db.close()

                await asyncio.sleep(1.0)

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
        self._wp_denial_counts.pop(run_id, None)
        self._executed_paths.pop(run_id, None)
        self._last_positions.pop(run_id, None)
        self._stagnant_counts.pop(run_id, None)
