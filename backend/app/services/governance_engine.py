from __future__ import annotations

from typing import Any, Dict
from app.schemas.governance import ActionProposal, GovernanceDecision
from app.policies.rules_python import evaluate_policies


class GovernanceEngine:
    """MVP governance engine (policy-as-code).

    In a fuller version, you could swap this with OPA or a hybrid system.
    """

    def evaluate(self, telemetry: Dict[str, Any], proposal: ActionProposal) -> GovernanceDecision:
        return evaluate_policies(telemetry, proposal)
