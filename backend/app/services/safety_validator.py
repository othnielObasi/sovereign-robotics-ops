"""Post-run safety validation (#14).

Validates a completed run against hard safety thresholds. Marks runs as
PASSED or FAILED_SAFETY based on aggregate metrics. Runs with critical
safety events are automatically invalidated.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.db.models import Run, Event, GovernanceDecisionRecord
from app.services.scoring_engine import compute_scorecard

logger = logging.getLogger("app.safety_validator")

# Hard thresholds — runs breaching these are marked FAILED_SAFETY
SAFETY_SCORE_MIN = 0.40         # minimum acceptable safety score
COMPLIANCE_SCORE_MIN = 0.30     # minimum acceptable compliance score
MAX_HARD_FAIL_DENIALS = 3       # maximum allowed hard-fail denials before invalid
MAX_ESCALATIONS = 10            # too many escalations = systemic issue
MAX_CONSECUTIVE_DENIALS = 10    # indicates unresolvable policy conflict


def validate_run_safety(db: Session, run_id: str) -> Dict[str, Any]:
    """Validate a run's safety post-completion.

    Returns a safety report with verdict: PASSED or FAILED_SAFETY.
    """
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        return {"verdict": "ERROR", "reason": "run_not_found"}

    # Compute scorecard
    scorecard = compute_scorecard(db, run_id)
    if "error" in scorecard:
        return {"verdict": "ERROR", "reason": scorecard["error"]}

    scores = scorecard.get("scores", {})
    metrics = scorecard.get("metrics", {})

    violations: List[Dict[str, str]] = []
    warnings: List[str] = []

    # Check hard safety thresholds
    if scores.get("safety", 1.0) < SAFETY_SCORE_MIN:
        violations.append({
            "rule": "SAFETY_SCORE_BELOW_MINIMUM",
            "detail": f"Safety score {scores['safety']:.3f} < threshold {SAFETY_SCORE_MIN}",
            "severity": "CRITICAL",
        })

    if scores.get("compliance", 1.0) < COMPLIANCE_SCORE_MIN:
        violations.append({
            "rule": "COMPLIANCE_SCORE_BELOW_MINIMUM",
            "detail": f"Compliance score {scores['compliance']:.3f} < threshold {COMPLIANCE_SCORE_MIN}",
            "severity": "CRITICAL",
        })

    # Check escalation count
    escalated = metrics.get("escalated", 0)
    if escalated > MAX_ESCALATIONS:
        violations.append({
            "rule": "EXCESSIVE_ESCALATIONS",
            "detail": f"Escalations {escalated} > threshold {MAX_ESCALATIONS}",
            "severity": "HIGH",
        })

    # Check for hard-fail policy violations
    decisions = (
        db.query(GovernanceDecisionRecord)
        .filter(GovernanceDecisionRecord.run_id == run_id)
        .all()
    )

    hard_fail_count = 0
    for d in decisions:
        hits = json.loads(d.policy_hits or "[]")
        from app.policies.rules_python import HARD_FAIL_POLICIES
        if any(p in HARD_FAIL_POLICIES for p in hits) and d.decision == "DENIED":
            hard_fail_count += 1

    if hard_fail_count > MAX_HARD_FAIL_DENIALS:
        violations.append({
            "rule": "EXCESSIVE_HARD_FAIL_DENIALS",
            "detail": f"Hard-fail denials {hard_fail_count} > threshold {MAX_HARD_FAIL_DENIALS}",
            "severity": "CRITICAL",
        })

    # Check for consecutive denial streaks
    max_streak = 0
    current_streak = 0
    for d in sorted(decisions, key=lambda x: x.ts if x.ts else ""):
        if d.decision in ("DENIED", "NEEDS_REVIEW"):
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    if max_streak >= MAX_CONSECUTIVE_DENIALS:
        violations.append({
            "rule": "CONSECUTIVE_DENIAL_STREAK",
            "detail": f"Max consecutive denials {max_streak} >= threshold {MAX_CONSECUTIVE_DENIALS}",
            "severity": "HIGH",
        })

    # Check for geofence breaches during execution
    geofence_exec_events = (
        db.query(Event)
        .filter(Event.run_id == run_id, Event.type == "EXECUTION")
        .all()
    )
    # If any execution happened while geofence was violated, that's critical
    for e in geofence_exec_events:
        try:
            payload = json.loads(e.payload_json)
            cmd = payload.get("command", {})
            result = payload.get("result", {})
            # Check if target was outside geofence
            from app.world_model import GEOFENCE
            params = cmd.get("params", {})
            tx, ty = float(params.get("x", 0)), float(params.get("y", 0))
            if not (GEOFENCE["min_x"] <= tx <= GEOFENCE["max_x"] and
                    GEOFENCE["min_y"] <= ty <= GEOFENCE["max_y"]):
                violations.append({
                    "rule": "GEOFENCE_BREACH_DURING_EXECUTION",
                    "detail": f"Execution targeted ({tx:.1f}, {ty:.1f}) outside geofence",
                    "severity": "CRITICAL",
                })
                break  # one is enough
        except Exception:
            continue

    # Warnings (non-blocking)
    if scores.get("efficiency", 1.0) < 0.2:
        warnings.append(f"Very low efficiency ({scores['efficiency']:.3f}) — may indicate planning issues")
    if metrics.get("stagnation_count", 0) > 5:
        warnings.append(f"High stagnation count ({metrics['stagnation_count']}) — robot may have been stuck")

    verdict = "FAILED_SAFETY" if violations else "PASSED"

    report = {
        "verdict": verdict,
        "run_id": run_id,
        "run_status": run.status,
        "scores": scores,
        "violations": violations,
        "warnings": warnings,
        "thresholds": {
            "safety_score_min": SAFETY_SCORE_MIN,
            "compliance_score_min": COMPLIANCE_SCORE_MIN,
            "max_hard_fail_denials": MAX_HARD_FAIL_DENIALS,
            "max_escalations": MAX_ESCALATIONS,
            "max_consecutive_denials": MAX_CONSECUTIVE_DENIALS,
        },
        "metrics_summary": {
            "total_decisions": metrics.get("total_decisions", 0),
            "denied": metrics.get("denied", 0),
            "hard_fail_denials": hard_fail_count,
            "escalated": escalated,
            "max_consecutive_denials": max_streak,
        },
    }

    # Persist verdict on the run
    run.safety_verdict = verdict
    run.safety_report_json = json.dumps(report)

    return report
