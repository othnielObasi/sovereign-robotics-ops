from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
from app.schemas.governance import ActionProposal


class SimpleAgent:
    """A tiny agent that proposes actions.

    For MVP reliability, this is deterministic and structured (no LLM required).
    It still demonstrates the loop: propose -> govern -> execute -> audit.

    Behavior:
    - Move toward goal with initial speed 0.8
    - If last decision was denied/reviewed due to speed, reduce to 0.4
    """

    def __init__(self):
        self.last_adjusted_speed: Optional[float] = None

    def propose(self, telemetry: Dict[str, Any], goal: Dict[str, Any], last_governance: Optional[Dict[str, Any]] = None) -> ActionProposal:
        x, y = float(telemetry.get("x", 0.0)), float(telemetry.get("y", 0.0))
        gx, gy = float(goal.get("x", 0.0)), float(goal.get("y", 0.0))

        # If close to goal, stop
        if abs(x - gx) < 0.3 and abs(y - gy) < 0.3:
            return ActionProposal(intent="STOP", params={}, rationale="Reached goal.")

        # Default higher speed
        speed = 0.8

        # If governance previously denied/reviewed due to speed/human/obstacle, slow down
        if last_governance:
            hits = set(last_governance.get("policy_hits", []))
            if {"SAFE_SPEED_01", "HUMAN_CLEARANCE_02", "OBSTACLE_CLEARANCE_03", "UNCERTAINTY_04"} & hits:
                speed = 0.4

        return ActionProposal(
            intent="MOVE_TO",
            params={"x": gx, "y": gy, "max_speed": speed},
            rationale="Navigate toward mission goal using a safe speed profile.",
        )


class AgentRouter:
    """Select between a deterministic agent and an optional LLM planner."""

    def __init__(self):
        self.simple = SimpleAgent()
        self._gemini = None

    def _gemini_planner(self):
        if self._gemini is None:
            from app.services.gemini_planner import GeminiPlanner
            self._gemini = GeminiPlanner()
        return self._gemini

    async def propose(
        self,
        telemetry: Dict[str, Any],
        goal: Dict[str, float],
        nl_task: str,
        last_governance: Optional[Dict[str, Any]] = None,
    ) -> ActionProposal:
        # Default: deterministic
        from app.config import settings

        if not settings.llm_enabled:
            return self.simple.propose(telemetry, goal, last_governance)

        provider = settings.llm_provider
        if provider == "gemini":
            try:
                return await self._gemini_planner().propose(telemetry, goal, nl_task, last_governance)
            except Exception:
                # Hard fallback to deterministic behavior for demo reliability
                return self.simple.propose(telemetry, goal, last_governance)

        return self.simple.propose(telemetry, goal, last_governance)
