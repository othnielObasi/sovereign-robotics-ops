from __future__ import annotations

"""Run lifecycle manager — the runtime core of the SRO platform.

This module owns the full lifecycle of a "run" (a single execution attempt
of a mission).  Key responsibilities:

1. **Start / stop / pause / resume** — state machine transitions with
   parent-mission synchronisation and operator intervention logging.
2. **The run loop** (`_run_loop`) — an async tick-based control loop that:
   - Reads telemetry from the simulator.
   - Validates telemetry plausibility (anti-spoofing).
   - Asks the agent/planner for the next action proposal.
   - Passes proposals through the governance engine.
   - Executes approved commands on the simulator.
   - Records every decision in a SHA-256 hash-chained event log
     for tamper-evident auditing.
3. **Diagnostics** — stagnation detection, execution verification,
   runtime integrity checks, and replan-on-denial logic.
4. **Post-run analytics** — safety validation, cross-run learning, and
   lesson extraction (fire-and-forget after completion).
"""

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
from app.services.telemetry_validator import TelemetryValidator
from app.services.integrity_monitor import RuntimeIntegrityChecker
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
        # --- Concurrency primitives (keyed by run_id) ---
        self._tasks: Dict[str, asyncio.Task] = {}       # active asyncio loop tasks
        self._stop_flags: Dict[str, asyncio.Event] = {} # set → graceful shutdown
        self._pause_flags: Dict[str, asyncio.Event] = {} # set = paused (loop sleeps)
        self._ws_broadcast = None  # WebSocket broadcast callback, injected by WS manager

        # --- Plan state (keyed by run_id) ---
        self._plans: Dict[str, List[Dict[str, Any]]] = {}  # ordered waypoint queue
        self._plans_lock = asyncio.Lock()  # protects concurrent reads/writes to _plans

        # --- Stagnation detection ---
        self._last_positions: Dict[str, tuple[float, float]] = {}  # last (x, y) per run
        self._stagnant_counts: Dict[str, int] = {}  # consecutive low-movement ticks
        self.STAGNATION_THRESHOLD_M = 0.02  # metres: movement below this = stagnant
        self.STAGNATION_CYCLES = 10         # ticks: emit STAGNATION alert after this many

        # --- Replan-on-denial ---
        self._wp_denial_counts: Dict[str, int] = {}  # consecutive governance denials
        self.REPLAN_DENIAL_THRESHOLD = 5  # trigger LLM re-plan after N consecutive denials

        # --- Executed path tracking (for UI visualisation & scoring) ---
        self._executed_paths: Dict[str, List[Dict[str, Any]]] = {}

        # --- Anti-spoofing: per-run telemetry plausibility validators ---
        self._tel_validators: Dict[str, TelemetryValidator] = {}

        # --- Anti-gaming: per-run runtime integrity checkers ---
        self._integrity_checkers: Dict[str, RuntimeIntegrityChecker] = {}

        # --- Execution verification ---
        self.EXEC_VERIFY_TOLERANCE_M = 2.0  # metres: max allowed discrepancy between
                                             # commanded and actual position after exec

        self.sim = SimAdapter()
        self.agent = AgentRouter()
        self.gov = GovernanceEngine()
        self.tel = TelemetryService()

    def bind_broadcaster(self, broadcaster):
        self._ws_broadcast = broadcaster

    def _append_event(self, db: Session, run_id: str, etype: str, payload: Dict[str, Any]) -> Event:
        """Append an event to the tamper-evident hash chain for a run.

        Each event stores the SHA-256 hash of the previous event, forming a
        linked chain analogous to a blockchain.  Any retrospective modification
        of an event breaks the chain, which is detected by the audit verifier
        (see ``replay_service.verify_chain``).

        Returns the newly created Event ORM row (already flushed to DB).
        """
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
        db.flush()  # ensure subsequent _append_event calls see this row for chain linking
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
            status="planning",
            started_at=utc_now(),
            ended_at=None,
            policy_version=pv_hash,
            planning_mode="llm_with_fallback",
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # Do NOT launch loop yet — caller must attach a plan first, then
        # call begin_running() to transition from "planning" → "running".
        return run

    def begin_running(self, db: Session, run_id: str) -> None:
        """Transition a run from 'planning' to 'running' and launch the loop.

        Must be called only after a plan has been attached via self._plans.
        """
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run or run.status != "planning":
            return
        run.status = "running"
        db.commit()
        self._launch_loop(run_id)
        logger.info("Run %s transitioned planning → running", run_id)

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
            # Sync parent mission status
            from app.db.models import Mission
            mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
            if mission and mission.status == "executing":
                mission.status = "paused"
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

        # Return robot to parking station on manual stop
        try:
            await self.sim.reset_robot()
            logger.info("Run %s: robot returned to parking after manual stop", run_id)
        except Exception:
            pass

    async def pause_run(self, db: Session, run_id: str) -> None:
        """Pause a running run — loop continues but stops executing actions."""
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run or run.status != "running":
            return

        if run_id not in self._pause_flags:
            self._pause_flags[run_id] = asyncio.Event()
        self._pause_flags[run_id].set()  # set = paused

        run.status = "paused"
        # Sync parent mission status
        from app.db.models import Mission
        mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
        if mission and mission.status == "executing":
            mission.status = "paused"
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
        # Sync parent mission status
        from app.db.models import Mission
        mission = db.query(Mission).filter(Mission.id == run.mission_id).first()
        if mission and mission.status in ("paused", "draft"):
            mission.status = "executing"
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

    async def _post_run_analytics(self, run_id: str) -> None:
        """Run heavy post-completion analytics in a background task.

        This is fire-and-forget — the run is already committed as 'completed'.
        Failures here are logged but never affect the run status.
        """
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            # Safety validation (#14)
            try:
                from app.services.safety_validator import validate_run_safety
                safety = validate_run_safety(db, run_id)
                if safety and safety.get("verdict") in ("FAILED", "FAILED_SAFETY"):
                    run = db.query(Run).filter(Run.id == run_id).first()
                    if run:
                        run.status = "failed_safety"
                        db.commit()
                        logger.warning("Run %s failed safety validation: %s", run_id, safety.get("violations"))
            except Exception as sv_err:
                logger.warning("Post-run safety validation error for %s: %s", run_id, sv_err)

            # Cross-run learning (#18) — limit to 5 recent runs to avoid DB overload
            try:
                from app.services.cross_run_learning import aggregate_cross_run_lessons
                aggregate_cross_run_lessons(db, limit=5)
            except Exception as crl_err:
                logger.warning("Post-run cross-run learning error for %s: %s", run_id, crl_err)

            # Extract lessons (#18)
            try:
                from app.services.persistent_memory import PersistentMemory
                pmem = PersistentMemory()
                pmem.extract_lessons_from_run(db, run_id)
            except Exception as les_err:
                logger.warning("Post-run lesson extraction error for %s: %s", run_id, les_err)
        except Exception as e:
            logger.warning("Post-run analytics failed for %s: %s", run_id, e)
        finally:
            db.close()

    MAX_CONSECUTIVE_TICK_ERRORS = 5
    AGENT_PROPOSAL_TIMEOUT = 15  # seconds

    async def _run_loop(self, run_id: str) -> None:
        """Core tick-based control loop for a single run.

        Each tick:
          1. Read telemetry from the simulator.
          2. Validate telemetry plausibility (anti-spoofing).
          3. Detect stagnation (robot not moving).
          4. Obtain an action proposal — either the next planned waypoint
             or a live agent/LLM proposal.
          5. Evaluate the proposal through the governance engine.
          6. If approved, execute the command on the simulator.
          7. If denied repeatedly, trigger autonomous re-planning.
          8. Record every decision in the hash-chained event log.
          9. Broadcast state to the frontend via WebSocket.

        The loop exits when the robot reaches the goal (STOP approved),
        the operator stops/pauses, or too many consecutive errors occur.
        """
        # IMPORTANT: DB sessions are not thread-safe; create per tick iteration.
        from app.db.session import SessionLocal
        from app.db.models import Mission

        last_governance: Optional[Dict[str, Any]] = None
        consecutive_errors = 0

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

                    # --- Anti-spoofing: validate telemetry plausibility ---
                    if run_id not in self._tel_validators:
                        self._tel_validators[run_id] = TelemetryValidator(run_id)
                    tv_result = self._tel_validators[run_id].validate(telemetry)
                    if tv_result.hard_anomaly:
                        # Hard anomaly = untrusted telemetry → emergency stop
                        anomaly_detail = "; ".join(a.detail for a in tv_result.anomalies if a.severity == "hard")
                        logger.error(
                            "Run %s: HARD telemetry anomaly — forcing stop: %s",
                            run_id, anomaly_detail,
                        )
                        self._append_event(db, run_id, "ALERT", {
                            "event": "telemetry_anomaly",
                            "severity": "hard",
                            "detail": anomaly_detail,
                            "anomalies": [{"type": a.type, "detail": a.detail, "field": a.field} for a in tv_result.anomalies],
                        })
                        # Send STOP to sim and abort tick
                        try:
                            await self.sim.send_command({"intent": "STOP", "params": {}})
                        except Exception:
                            pass
                        db.commit()
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {
                                "kind": "alert",
                                "data": {"event": "TELEMETRY_ANOMALY", "severity": "hard", "detail": anomaly_detail},
                            })
                        await asyncio.sleep(1)
                        continue
                    elif tv_result.anomalies:
                        # Soft anomalies — log but continue
                        self._append_event(db, run_id, "ALERT", {
                            "event": "telemetry_anomaly",
                            "severity": "soft",
                            "anomalies": [{"type": a.type, "detail": a.detail, "field": a.field} for a in tv_result.anomalies],
                        })

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

                    # Snapshot plan under lock to avoid races with LLM plan upgrades
                    async with self._plans_lock:
                        plan_wps = self._plans.get(run_id)
                        wp = plan_wps[0] if plan_wps else None
                    if wp:
                        proposal = ActionProposal(
                            intent="MOVE_TO",
                            params={"x": float(wp.get("x")), "y": float(wp.get("y")), "max_speed": float(wp.get("max_speed", 0.5))},
                            rationale="Following LLM plan waypoint",
                        )
                    else:
                        # No plan — agent proposes action (may call LLM)
                        world_state = None
                        try:
                            world_state = await self.sim.get_world()
                        except Exception:
                            pass
                        try:
                            async with asyncio.timeout(self.AGENT_PROPOSAL_TIMEOUT):
                                proposal = await self.agent.propose(telemetry, goal, nl_task, last_governance, world_state)
                        except (asyncio.TimeoutError, Exception) as prop_err:
                            logger.warning("Run %s: agent proposal failed/timed out: %s — using deterministic fallback", run_id, prop_err)
                            proposal = self.agent.simple.propose(telemetry, goal, last_governance)
                    # Clamp planned max_speed to zone limits and human proximity
                    if proposal.intent == "MOVE_TO":
                        zone = telemetry.get("zone", "aisle")
                        limit = float(ZONE_SPEED_LIMITS.get(zone, 0.5))
                        p = proposal.params or {}
                        clamped = min(float(p.get("max_speed", 0.5)), limit)
                        # Also clamp near humans (slow-radius preemption)
                        human_dist = float(telemetry.get("human_distance_m", 999.0))
                        if human_dist < 3.0:
                            clamped = min(clamped, 0.3)
                        p["max_speed"] = clamped
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

                    # --- Runtime integrity check (anti-gaming) ---
                    if run_id not in self._integrity_checkers:
                        self._integrity_checkers[run_id] = RuntimeIntegrityChecker(run_id)
                    gaming_flags = self._integrity_checkers[run_id].check_tick(
                        proposal.intent,
                        proposal.params or {},
                        gov_decision.decision,
                    )
                    if gaming_flags:
                        self._append_event(db, run_id, "ALERT", {
                            "event": "runtime_integrity",
                            "flags": gaming_flags,
                        })
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {
                                "kind": "alert",
                                "data": {"event": "RUNTIME_INTEGRITY", "flags": gaming_flags},
                            })

                    # If approved, execute
                    execution = None
                    was_executed = False
                    if gov_decision.decision == "APPROVED":
                        # Reset waypoint denial counter on approval
                        self._wp_denial_counts[run_id] = 0

                        cmd = {"intent": proposal.intent, "params": proposal.params}
                        execution = await self.sim.send_command(cmd)

                        # --- Execution verification: confirm sim actually responded ---
                        exec_verified = False
                        try:
                            # Check the response from send_command directly
                            if proposal.intent == "MOVE_TO":
                                sim_ack = execution.get("ok", False) or execution.get("ack", False)
                                exec_verified = sim_ack
                            elif proposal.intent == "STOP":
                                sim_ack = execution.get("ok", False) or execution.get("stopped", False)
                                exec_verified = sim_ack
                            else:
                                exec_verified = True
                        except Exception as verify_err:
                            logger.warning("Run %s: execution verification failed: %s", run_id, verify_err)
                            exec_verified = True  # fail-open on verification errors to avoid blocking

                        exec_payload = {"command": cmd, "result": execution, "verified": exec_verified}
                        self._append_event(db, run_id, "EXECUTION", exec_payload)
                        was_executed = True

                        if not exec_verified:
                            self._append_event(db, run_id, "ALERT", {
                                "event": "execution_unverified",
                                "detail": "Simulator did not acknowledge command execution",
                                "command": cmd,
                            })

                        # Track executed path
                        self._executed_paths.setdefault(run_id, []).append({
                            "x": round(float(telemetry.get("x", 0)), 4),
                            "y": round(float(telemetry.get("y", 0)), 4),
                            "speed": round(float(telemetry.get("speed", 0)), 4),
                            "ts": utc_now().isoformat(),
                        })

                        # If we executed a planned waypoint, remove it from the plan
                        if wp:
                            async with self._plans_lock:
                                try:
                                    cur = self._plans.get(run_id)
                                    if cur:
                                        cur.pop(0)
                                        if not cur:
                                            self._plans.pop(run_id, None)
                                except Exception:
                                    pass
                    else:
                        # Denied or NEEDS_REVIEW — increment waypoint denial counter
                        self._wp_denial_counts[run_id] = self._wp_denial_counts.get(run_id, 0) + 1
                        denial_count = self._wp_denial_counts[run_id]

                        # NEEDS_REVIEW with escalation: pause run for operator decision
                        if gov_decision.decision == "NEEDS_REVIEW":
                            logger.warning("Run %s: NEEDS_REVIEW — pausing for operator", run_id)
                            run.status = "paused"
                            if mission and mission.status == "executing":
                                mission.status = "paused"
                            self._append_event(db, run_id, "INTERVENTION", {
                                "type": "AUTO_PAUSE",
                                "reason": "Governance requires operator review",
                                "policy_hits": gov_decision.policy_hits,
                                "denial_count": denial_count,
                            })
                            db.commit()
                            if self._ws_broadcast:
                                await self._ws_broadcast(run_id, {
                                    "kind": "status",
                                    "data": {
                                        "status": "paused",
                                        "reason": "needs_operator_review",
                                        "policy_hits": gov_decision.policy_hits,
                                        "denial_reasons": gov_decision.reasons,
                                    },
                                })
                            # Wait for operator to resume via override endpoint
                            if run_id not in self._pause_flags:
                                self._pause_flags[run_id] = asyncio.Event()
                            self._pause_flags[run_id].set()

                        elif denial_count >= self.REPLAN_DENIAL_THRESHOLD and wp:
                            # Trigger replanning: discard blocked waypoint and request new plan
                            blocked_wp = wp
                            logger.warning(
                                "Run %s: %d consecutive denials on waypoint %s — triggering replan",
                                run_id, denial_count, blocked_wp,
                            )
                            # Remove the blocked waypoint
                            async with self._plans_lock:
                                try:
                                    cur = self._plans.get(run_id)
                                    if cur:
                                        cur.pop(0)
                                        if not cur:
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
                                    async with self._plans_lock:
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

                        # Commit completion status IMMEDIATELY so the run is
                        # never left as "running" even if post-run analytics fail.
                        db.commit()
                        logger.info("Run %s completed (mission %s)", run_id, mission.id if mission else "?")

                        # Return robot to parking station (reset to start position)
                        try:
                            await self.sim.reset_robot()
                            logger.info("Run %s: robot returned to parking station", run_id)
                        except Exception as reset_err:
                            logger.warning("Run %s: failed to reset robot to parking: %s", run_id, reset_err)

                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "completed"}})

                        # Fire-and-forget: heavy post-run analytics in background
                        asyncio.create_task(self._post_run_analytics(run_id))
                        break

                    # Tick succeeded — reset error counter
                    consecutive_errors = 0

                except Exception as tick_err:
                    consecutive_errors += 1
                    logger.warning(
                        "Run %s: tick error (%d/%d): %s",
                        run_id, consecutive_errors, self.MAX_CONSECUTIVE_TICK_ERRORS, tick_err,
                    )
                    try:
                        db.rollback()
                    except Exception:
                        pass
                    if consecutive_errors >= self.MAX_CONSECUTIVE_TICK_ERRORS:
                        logger.error("Run %s: too many consecutive tick errors, marking failed", run_id)
                        try:
                            run = db.query(Run).filter(Run.id == run_id).first()
                            if run:
                                run.status = "failed"
                                run.ended_at = utc_now()
                                # Sync parent mission status
                                from app.db.models import Mission as _Mission
                                mission = db.query(_Mission).filter(_Mission.id == run.mission_id).first()
                                if mission and mission.status == "executing":
                                    mission.status = "failed"
                                db.commit()
                        except Exception:
                            pass
                        # Return robot to parking station even on failure
                        try:
                            await self.sim.reset_robot()
                            logger.info("Run %s: robot returned to parking after failure", run_id)
                        except Exception:
                            pass
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
                    # Sync parent mission status
                    from app.db.models import Mission as _Mission
                    mission = db.query(_Mission).filter(_Mission.id == run.mission_id).first()
                    if mission and mission.status == "executing":
                        mission.status = "failed"
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
