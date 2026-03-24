from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.schemas.governance import ActionProposal, GovernanceDecision
from app.policies.rules_python import evaluate_policies
from app.db.models import GovernanceDecisionRecord
from app.utils.time import utc_now
from app.policies.versioning import policy_version_hash

logger = logging.getLogger("app.governance")

# Escalation: consecutive denials before auto-escalation
CONSECUTIVE_DENIAL_ESCALATION = 3


class GovernanceEngine:
    """Runtime governance engine — evaluates, persists, and tracks decisions.

    Responsibilities:
    - Evaluate proposals against all active policies
    - Persist every decision to governance_decisions table
    - Track consecutive denials per run for circuit-breaker escalation
    - Provide queryable decision history
    """

    def __init__(self):
        self._consecutive_denials: Dict[str, int] = {}

    def evaluate(self, telemetry: Dict[str, Any], proposal: ActionProposal) -> GovernanceDecision:
        """Evaluate a proposal against policies. Stateless — does not persist."""
        return evaluate_policies(telemetry, proposal)

    def evaluate_and_record(
        self,
        db: Session,
        run_id: str,
        telemetry: Dict[str, Any],
        proposal: ActionProposal,
        was_executed: bool = False,
        event_hash: Optional[str] = None,
    ) -> GovernanceDecision:
        """Evaluate a proposal, persist the decision, and handle escalation logic."""
        decision = evaluate_policies(telemetry, proposal)

        # Circuit-breaker: track consecutive denials
        escalated = False
        if decision.decision in ("DENIED", "NEEDS_REVIEW"):
            self._consecutive_denials[run_id] = self._consecutive_denials.get(run_id, 0) + 1
            if self._consecutive_denials[run_id] >= CONSECUTIVE_DENIAL_ESCALATION:
                escalated = True
                if "CIRCUIT_BREAKER" not in decision.reasons:
                    decision.reasons.append(
                        f"Circuit breaker: {self._consecutive_denials[run_id]} consecutive denials — operator escalation required"
                    )
                if decision.decision == "DENIED":
                    decision.decision = "NEEDS_REVIEW"
                logger.warning(
                    "Run %s: circuit breaker triggered after %d consecutive denials",
                    run_id, self._consecutive_denials[run_id],
                )
        else:
            self._consecutive_denials[run_id] = 0

        # Build compact telemetry summary for storage
        tel_summary = {
            "x": round(float(telemetry.get("x", 0)), 2),
            "y": round(float(telemetry.get("y", 0)), 2),
            "speed": round(float(telemetry.get("speed", 0)), 3),
            "zone": telemetry.get("zone", "unknown"),
            "human_detected": bool(telemetry.get("human_detected", False)),
            "human_distance_m": round(float(telemetry.get("human_distance_m", 999)), 2),
            "nearest_obstacle_m": round(float(telemetry.get("nearest_obstacle_m", 999)), 2),
        }

        # Persist decision record
        record = GovernanceDecisionRecord(
            run_id=run_id,
            ts=utc_now(),
            decision=decision.decision,
            policy_state=decision.policy_state,
            risk_score=decision.risk_score,
            policy_hits=json.dumps(decision.policy_hits),
            reasons=json.dumps(decision.reasons),
            required_action=decision.required_action,
            proposal_intent=proposal.intent,
            proposal_json=json.dumps(proposal.model_dump()),
            telemetry_summary=json.dumps(tel_summary),
            was_executed="true" if was_executed else "false",
            event_hash=event_hash,
            escalated="true" if escalated else "false",
            policy_version=policy_version_hash(),
        )
        db.add(record)

        return decision

    def get_decisions(
        self,
        db: Session,
        run_id: str,
        decision_filter: Optional[str] = None,
        policy_state_filter: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Query governance decision history for a run."""
        q = db.query(GovernanceDecisionRecord).filter(
            GovernanceDecisionRecord.run_id == run_id
        )
        if decision_filter:
            q = q.filter(GovernanceDecisionRecord.decision == decision_filter)
        if policy_state_filter:
            q = q.filter(GovernanceDecisionRecord.policy_state == policy_state_filter)

        rows = q.order_by(GovernanceDecisionRecord.ts.desc()).offset(offset).limit(limit).all()
        return [self._decision_to_dict(r) for r in rows]

    def get_decision_stats(self, db: Session, run_id: str) -> Dict[str, Any]:
        """Aggregate statistics for governance decisions in a run."""
        rows = db.query(GovernanceDecisionRecord).filter(
            GovernanceDecisionRecord.run_id == run_id
        ).all()

        if not rows:
            return {"total": 0, "approved": 0, "denied": 0, "needs_review": 0,
                    "escalated": 0, "avg_risk_score": 0.0, "max_risk_score": 0.0,
                    "policy_hit_counts": {}, "policy_state_counts": {}}

        total = len(rows)
        approved = sum(1 for r in rows if r.decision == "APPROVED")
        denied = sum(1 for r in rows if r.decision == "DENIED")
        needs_review = sum(1 for r in rows if r.decision == "NEEDS_REVIEW")
        escalated_count = sum(1 for r in rows if r.escalated == "true")
        risk_scores = [r.risk_score for r in rows]

        # Count policy hits
        policy_counts: Dict[str, int] = {}
        for r in rows:
            for pid in json.loads(r.policy_hits or "[]"):
                policy_counts[pid] = policy_counts.get(pid, 0) + 1

        # Count policy states
        state_counts: Dict[str, int] = {}
        for r in rows:
            state_counts[r.policy_state] = state_counts.get(r.policy_state, 0) + 1

        return {
            "total": total,
            "approved": approved,
            "denied": denied,
            "needs_review": needs_review,
            "escalated": escalated_count,
            "approval_rate": round(approved / total, 3) if total else 0,
            "avg_risk_score": round(sum(risk_scores) / total, 3) if total else 0,
            "max_risk_score": round(max(risk_scores), 3) if risk_scores else 0,
            "policy_hit_counts": policy_counts,
            "policy_state_counts": state_counts,
        }

    def get_receipt(self, db: Session, run_id: str, decision_id: int) -> Optional[Dict[str, Any]]:
        """Get a single governance receipt — structured proof of a decision."""
        record = db.query(GovernanceDecisionRecord).filter(
            GovernanceDecisionRecord.id == decision_id,
            GovernanceDecisionRecord.run_id == run_id,
        ).first()
        if not record:
            return None
        return self._decision_to_receipt(record)

    def get_receipts(self, db: Session, run_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get all governance receipts for a run (structured decision proofs)."""
        rows = db.query(GovernanceDecisionRecord).filter(
            GovernanceDecisionRecord.run_id == run_id
        ).order_by(GovernanceDecisionRecord.ts.asc()).limit(limit).all()
        return [self._decision_to_receipt(r) for r in rows]

    @staticmethod
    def _decision_to_dict(record: GovernanceDecisionRecord) -> Dict[str, Any]:
        return {
            "id": record.id,
            "run_id": record.run_id,
            "ts": record.ts.isoformat() if record.ts else None,
            "decision": record.decision,
            "policy_state": record.policy_state,
            "risk_score": record.risk_score,
            "policy_hits": json.loads(record.policy_hits or "[]"),
            "reasons": json.loads(record.reasons or "[]"),
            "required_action": record.required_action,
            "proposal_intent": record.proposal_intent,
            "was_executed": record.was_executed == "true",
            "escalated": record.escalated == "true",
            "event_hash": record.event_hash,
        }

    @staticmethod
    def _decision_to_receipt(record: GovernanceDecisionRecord) -> Dict[str, Any]:
        """A governance receipt is structured proof of why an action was allowed or blocked."""
        policy_hits = json.loads(record.policy_hits or "[]")
        reasons = json.loads(record.reasons or "[]")
        proposal = json.loads(record.proposal_json or "{}")
        telemetry = json.loads(record.telemetry_summary or "{}")

        return {
            "receipt_id": record.id,
            "run_id": record.run_id,
            "timestamp": record.ts.isoformat() if record.ts else None,
            "verdict": {
                "decision": record.decision,
                "policy_state": record.policy_state,
                "risk_score": record.risk_score,
                "was_executed": record.was_executed == "true",
                "escalated": record.escalated == "true",
            },
            "proposal": {
                "intent": record.proposal_intent,
                "params": proposal.get("params", {}),
                "rationale": proposal.get("rationale", ""),
            },
            "policy_evaluation": {
                "policies_triggered": policy_hits,
                "reasons": reasons,
                "required_action": record.required_action,
            },
            "context": {
                "telemetry_snapshot": telemetry,
            },
            "integrity": {
                "event_hash": record.event_hash,
            },
        }
