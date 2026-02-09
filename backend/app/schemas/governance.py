from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional


Decision = Literal["APPROVED", "DENIED", "NEEDS_REVIEW"]


class ActionProposal(BaseModel):
    intent: Literal["MOVE_TO", "STOP", "WAIT"] = "MOVE_TO"
    params: Dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""


class GovernanceDecision(BaseModel):
    decision: Decision
    policy_hits: List[str] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)
    required_action: Optional[str] = None
    risk_score: float = 0.0


class PolicyInfo(BaseModel):
    policy_id: str
    name: str
    description: str
    severity: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
