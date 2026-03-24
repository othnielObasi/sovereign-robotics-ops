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
