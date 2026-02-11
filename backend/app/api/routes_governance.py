from __future__ import annotations

import yaml
from fastapi import APIRouter
from typing import Any, Dict

from app.schemas.governance import PolicyInfo, ActionProposal, GovernanceDecision
from app.policies.rules_python import evaluate_policies

router = APIRouter()


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
        )
        for p in policies
    ]


@router.post("/policies/test", response_model=GovernanceDecision)
def test_policy(payload: Dict[str, Any]):
    """Test an action proposal against policies without running a full mission.

    Expected JSON:
    {
      "telemetry": {...},
      "proposal": {"intent":"MOVE_TO","params":{...},"rationale":"..."}
    }
    """
    telemetry = payload.get("telemetry") or {}
    proposal_raw = payload.get("proposal") or {}
    proposal = ActionProposal(**proposal_raw)
    return evaluate_policies(telemetry, proposal)
