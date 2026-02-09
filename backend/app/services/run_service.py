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

        self.sim = SimAdapter()
        self.agent = AgentRouter()
        self.gov = GovernanceEngine()
        self.tel = TelemetryService()

    def bind_broadcaster(self, broadcaster):
        self._ws_broadcast = broadcaster

    def _append_event(self, db: Session, run_id: str, etype: str, payload: Dict[str, Any]) -> Event:
        evt = {
            "run_id": run_id,
            "ts": utc_now().isoformat(),
            "type": etype,
            "payload": payload,
        }
        evt_hash = sha256_canonical(evt)
        row = Event(
            id=new_id("evt"),
            run_id=run_id,
            ts=utc_now(),
            type=etype,
            payload_json=json.dumps(payload, ensure_ascii=False),
            hash=evt_hash,
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

        stop_event = asyncio.Event()
        self._stop_flags[run.id] = stop_event

        self._tasks[run.id] = asyncio.create_task(self._run_loop(run.id))
        return run

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

                    # Agent proposes action
                    proposal: ActionProposal = self.agent.propose(telemetry, goal, last_governance)
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
                    if gov_decision.decision == "APPROVED":
                        cmd = {"intent": proposal.intent, "params": proposal.params}
                        execution = await self.sim.send_command(cmd)
                        exec_payload = {"command": cmd, "result": execution}
                        self._append_event(db, run_id, "EXECUTION", exec_payload)

                    # Commit events/telemetry
                    db.commit()

                    # Broadcast event summary to UI
                    if self._ws_broadcast:
                        await self._ws_broadcast(run_id, {
                            "kind": "event",
                            "data": {
                                "type": "DECISION",
                                "proposal": proposal_payload,
                                "governance": gov_payload,
                                "execution": execution,
                            }
                        })

                    last_governance = gov_payload

                    # If STOP was approved, complete run
                    if proposal.intent == "STOP" and gov_decision.decision == "APPROVED":
                        run.status = "completed"
                        run.ended_at = utc_now()
                        db.commit()
                        if self._ws_broadcast:
                            await self._ws_broadcast(run_id, {"kind": "status", "data": {"status": "completed"}})
                        break

                finally:
                    db.close()

                await asyncio.sleep(0.5)

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
