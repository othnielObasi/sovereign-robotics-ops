from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings
from app.schemas.governance import ActionProposal


logger = logging.getLogger("app.gemini_planner")

_JSON_RE = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)

# Model cascade: robotics-er (primary) → pro → flash → deterministic fallback
MODEL_CASCADE: List[str] = [
    "gemini-robotics-er-1.5-preview",  # Primary: robotics-specialized
    "gemini-2.5-pro-preview-05-06",    # Fallback 1: deep reasoning
    "gemini-2.0-flash",                # Fallback 2: fast, high quota
]


def _extract_json(text: str) -> Any:
    """Extract first JSON object/array from a string."""
    m = _JSON_RE.search(text.strip())
    if not m:
        raise ValueError("No JSON found in model output")
    return json.loads(m.group(1))


class GeminiPlanner:
    """LLM planner with cascading model fallback for reliability."""

    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.primary_model = settings.gemini_model
        self.timeout_s = settings.gemini_timeout_s
        self.model_cascade = [self.primary_model] + [
            m for m in MODEL_CASCADE if m != self.primary_model
        ]

    async def _call_gemini(self, model: str, prompt: str) -> Optional[str]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "thinkingConfig": {"thinkingBudget": 0}},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                r = await client.post(url, headers=headers, json=payload)
                if r.status_code == 429:
                    logger.warning(f"Rate limited on {model}")
                    return None
                if r.status_code >= 400:
                    logger.warning(f"Error {r.status_code} on {model}: {r.text[:200]}")
                    return None
                data = r.json()
                return data["candidates"][0]["content"]["parts"][0].get("text", "")
        except Exception as e:
            logger.warning(f"Exception calling {model}: {e}")
            return None

    def _deterministic_proposal(self, telemetry: Dict[str, Any], goal: Dict[str, float]) -> ActionProposal:
        x, y = float(telemetry.get("x", 0)), float(telemetry.get("y", 0))
        gx, gy = float(goal.get("x", 0)), float(goal.get("y", 0))
        if abs(x - gx) < 0.5 and abs(y - gy) < 0.5:
            return ActionProposal(intent="STOP", params={}, rationale="[Fallback] Reached goal.")
        speed = 0.4 if telemetry.get("human_detected") else 0.6
        return ActionProposal(intent="MOVE_TO", params={"x": gx, "y": gy, "max_speed": speed},
                              rationale="[Fallback] Deterministic path to goal.")

    def _deterministic_plan(self, telemetry: Dict[str, Any], goal: Optional[Dict[str, float]]) -> Dict[str, Any]:
        x, y = float(telemetry.get("x", 0)), float(telemetry.get("y", 0))
        gx = float(goal.get("x", 15) if goal else 15)
        gy = float(goal.get("y", 10) if goal else 10)
        speed = 0.4 if telemetry.get("human_detected") else 0.6
        return {
            "waypoints": [{"x": (x+gx)/2, "y": (y+gy)/2, "max_speed": speed}, {"x": gx, "y": gy, "max_speed": speed}],
            "rationale": "[Fallback] Deterministic 2-waypoint plan.",
            "estimated_time_s": 15.0,
            "model_used": "deterministic_fallback",
        }

    async def propose(self, telemetry: Dict[str, Any], goal: Dict[str, float], nl_task: str,
                      last_governance: Optional[Dict[str, Any]] = None) -> ActionProposal:
        if not self.api_key:
            return self._deterministic_proposal(telemetry, goal)

        prompt = f"""You are the high-level reasoning layer for a simulated mobile robot.

TASK: {nl_task}

WORLD STATE: {json.dumps(telemetry, indent=2)}

GOAL: {json.dumps(goal)}

Output STRICT JSON: {{"intent":"MOVE_TO|STOP|WAIT","params":{{...}},"rationale":"..."}}
"""
        for model in self.model_cascade:
            logger.info(f"Trying model: {model}")
            text = await self._call_gemini(model, prompt)
            if text:
                try:
                    obj = _extract_json(text)
                    proposal = ActionProposal(**obj)
                    if proposal.intent == "MOVE_TO":
                        p = proposal.params or {}
                        p["x"] = float(p.get("x", goal.get("x", 0)))
                        p["y"] = float(p.get("y", goal.get("y", 0)))
                        p["max_speed"] = max(0.1, min(1.0, float(p.get("max_speed", 0.5))))
                        proposal.params = p
                    proposal.rationale = f"[{model}] {proposal.rationale}"
                    return proposal
                except Exception as e:
                    logger.warning(f"Parse failed {model}: {e}")
        return self._deterministic_proposal(telemetry, goal)

    async def generate_plan(self, telemetry: Dict[str, Any], instruction: str,
                            goal: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        if not self.api_key:
            return self._deterministic_plan(telemetry, goal)

        goal_text = f"GOAL: {json.dumps(goal)}" if goal else "No specific goal."
        prompt = f"""You are a robot planner in a 30x20m warehouse.

INSTRUCTION: {instruction}

STATE: {json.dumps(telemetry, indent=2)}

{goal_text}

Output STRICT JSON:
{{"waypoints": [{{"x": <float>, "y": <float>, "max_speed": <float>}}, ...], "rationale": "...", "estimated_time_s": <float>}}
"""
        for model in self.model_cascade:
            logger.info(f"Trying plan model: {model}")
            text = await self._call_gemini(model, prompt)
            if text:
                try:
                    obj = _extract_json(text)
                    waypoints = obj.get("waypoints", [])
                    for wp in waypoints:
                        wp["x"] = max(0.0, min(30.0, float(wp.get("x", 0))))
                        wp["y"] = max(0.0, min(20.0, float(wp.get("y", 0))))
                        wp["max_speed"] = max(0.1, min(1.0, float(wp.get("max_speed", 0.5))))
                    return {
                        "waypoints": waypoints,
                        "rationale": f"[{model}] {obj.get('rationale', '')}",
                        "estimated_time_s": float(obj.get("estimated_time_s", 0)),
                        "model_used": model,
                    }
                except Exception as e:
                    logger.warning(f"Plan parse failed {model}: {e}")
        return self._deterministic_plan(telemetry, goal)
