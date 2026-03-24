from __future__ import annotations

import yaml
from fastapi import APIRouter, Query, HTTPException
from typing import Any, Dict, List, Optional

from app.schemas.governance import (
    PolicyInfo, ActionProposal, GovernanceDecision,
    GovernanceDecisionOut, GovernanceReceiptOut, GovernanceStatsOut,
)
from app.policies.rules_python import evaluate_policies
from app.db.session import SessionLocal
from app.services.governance_engine import GovernanceEngine

router = APIRouter()

# Shared engine instance — will be replaced by run_service's engine at startup
_gov_engine = GovernanceEngine()


@router.get("/policies", response_model=list[PolicyInfo])
def list_policies():
    import pathlib
    catalog_path = pathlib.Path(__file__).resolve().parent.parent / "policies" / "policy_catalog.yaml"
    with open(catalog_path, "r", encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}
    policies = doc.get("policies", [])
    return [
        PolicyInfo(
            policy_id=p["policy_id"],
            name=p["name"],
            description=p["description"],
            severity=p.get("severity", "MEDIUM"),
            parameters=p.get("parameters"),
            trigger=p.get("trigger"),
            action=p.get("action"),
        )
        for p in policies
    ]


@router.post("/policies/test", response_model=GovernanceDecision)
def test_policy(payload: Dict[str, Any]):
    """Test an action proposal against policies without running a full mission."""
    telemetry = payload.get("telemetry") or {}
    proposal_raw = payload.get("proposal") or {}
    proposal = ActionProposal(**proposal_raw)
    return evaluate_policies(telemetry, proposal)


@router.post("/governance/evaluate", response_model=GovernanceDecision)
def governance_evaluate(payload: Dict[str, Any]):
    """Evaluate an AI-generated action against the governance policy layer.

    Every AI-planned action is intercepted here before execution.
    """
    telemetry = payload.get("telemetry") or {}
    proposal_raw = payload.get("proposal") or {}
    proposal = ActionProposal(**proposal_raw)
    return evaluate_policies(telemetry, proposal)


@router.get("/governance/decisions/{run_id}", response_model=List[GovernanceDecisionOut])
def get_governance_decisions(
    run_id: str,
    decision: Optional[str] = Query(None, description="Filter: APPROVED|DENIED|NEEDS_REVIEW"),
    policy_state: Optional[str] = Query(None, description="Filter: SAFE|SLOW|STOP|REPLAN"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Query governance decision history for a run.

    Returns all persisted governance decisions with filters for
    decision type and policy state. Ordered by most recent first.
    """
    db = SessionLocal()
    try:
        rows = _gov_engine.get_decisions(
            db, run_id,
            decision_filter=decision,
            policy_state_filter=policy_state,
            limit=limit,
            offset=offset,
        )
        return rows
    finally:
        db.close()


@router.get("/governance/decisions/{run_id}/stats", response_model=GovernanceStatsOut)
def get_governance_stats(run_id: str):
    """Get aggregate governance statistics for a run.

    Returns counts of decisions by type, policy hit frequency,
    risk score distribution, and escalation count.
    """
    db = SessionLocal()
    try:
        return _gov_engine.get_decision_stats(db, run_id)
    finally:
        db.close()


@router.get("/governance/receipts/{run_id}")
def get_governance_receipts(
    run_id: str,
    limit: int = Query(100, ge=1, le=1000),
):
    """Get governance receipts for a run.

    A receipt is structured proof of why each action was allowed or blocked,
    including the verdict, proposal, policy evaluation, context snapshot,
    and integrity hash linking to the chain-of-trust.
    """
    db = SessionLocal()
    try:
        return _gov_engine.get_receipts(db, run_id, limit=limit)
    finally:
        db.close()


@router.get("/governance/receipts/{run_id}/{decision_id}")
def get_governance_receipt(run_id: str, decision_id: int):
    """Get a single governance receipt by decision ID."""
    db = SessionLocal()
    try:
        receipt = _gov_engine.get_receipt(db, run_id, decision_id)
        if not receipt:
            raise HTTPException(status_code=404, detail="Decision not found")
        return receipt
    finally:
        db.close()


@router.get("/policies/version")
def get_policy_version():
    """Return the current policy version hash and all active parameters.

    The hash changes whenever any policy parameter is modified, enabling
    traceability of which policy configuration was active for each decision.
    """
    from app.policies.versioning import policy_version_info

    return policy_version_info()


# ── Governance-bounded optimizer (#7) ──

@router.get("/optimizer/envelope")
def get_optimization_envelope():
    """Return the governance envelope — hard safety bounds the optimizer respects."""
    from app.services.optimizer import get_optimization_envelope

    return get_optimization_envelope()


@router.get("/optimizer/analyze/{run_id}")
def analyze_run_optimization(run_id: str):
    """Analyse a run and produce governance-bounded optimization recommendations."""
    from app.services.optimizer import analyze_run_performance

    db = SessionLocal()
    try:
        return analyze_run_performance(db, run_id)
    finally:
        db.close()


# ── Adaptive tuning (#12, #13) ──

@router.get("/tuning/recommendations")
def get_tuning_recommendations():
    """Analyse historical runs and produce safe parameter tuning recommendations."""
    from app.services.adaptive_tuning import compute_tuning_recommendations

    db = SessionLocal()
    try:
        return compute_tuning_recommendations(db)
    finally:
        db.close()


# ── Anti-reward-hacking integrity monitor (#15) ──

@router.get("/integrity/run/{run_id}")
def check_run_integrity(run_id: str):
    """Check a run's scorecard for reward-hacking indicators."""
    from app.services.integrity_monitor import check_run_integrity

    db = SessionLocal()
    try:
        return check_run_integrity(db, run_id)
    finally:
        db.close()


@router.get("/integrity/cross-run")
def check_cross_run_integrity(limit: int = Query(10, ge=3, le=50)):
    """Analyse trends across multiple runs for systemic gaming patterns."""
    from app.services.integrity_monitor import check_cross_run_integrity

    db = SessionLocal()
    try:
        return check_cross_run_integrity(db, limit=limit)
    finally:
        db.close()


# ── Persistent agent memory (#17, #18) ──

@router.get("/agent/memory")
def get_agent_memory(
    category: Optional[str] = Query(None, description="Filter: decision|denial|learning|strategy"),
    limit: int = Query(30, ge=1, le=200),
):
    """Retrieve persistent agent memory entries."""
    from app.services.persistent_memory import PersistentMemory

    db = SessionLocal()
    try:
        mem = PersistentMemory()
        return mem.recall(db, category=category, limit=limit)
    finally:
        db.close()


@router.get("/agent/memory/stats")
def get_agent_memory_stats():
    """Get agent memory statistics."""
    from app.services.persistent_memory import PersistentMemory

    db = SessionLocal()
    try:
        mem = PersistentMemory()
        return mem.stats(db) if hasattr(mem, 'stats') else mem.get_stats(db)
    finally:
        db.close()


@router.post("/agent/memory/learn/{run_id}")
def extract_lessons(run_id: str):
    """Extract internalized lessons from a completed run (#18)."""
    from app.services.persistent_memory import PersistentMemory

    db = SessionLocal()
    try:
        mem = PersistentMemory()
        lessons = mem.extract_lessons_from_run(db, run_id)
        db.commit()
        return {"run_id": run_id, "lessons_extracted": len(lessons), "lessons": lessons}
    finally:
        db.close()


# ── Policy hard-failure classification (#14) ──

@router.get("/policies/classification")
def get_policy_classification():
    """Return the hard-fail vs soft-fail classification of all policies."""
    from app.policies.rules_python import HARD_FAIL_POLICIES, SOFT_FAIL_POLICIES

    return {
        "hard_fail": sorted(HARD_FAIL_POLICIES),
        "soft_fail": sorted(SOFT_FAIL_POLICIES),
        "description": {
            "hard_fail": "Immediate DENIED, no operator override possible",
            "soft_fail": "Can be DENIED or upgraded to NEEDS_REVIEW for operator decision",
        },
    }
