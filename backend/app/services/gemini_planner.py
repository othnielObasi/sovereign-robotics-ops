from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

import httpx

from app.config import settings
from app.schemas.governance import ActionProposal


_JSON_RE = re.compile(r"(\{.*\}|\[.*\])", re.DOTALL)


def _extract_json(text: str) -> Any:
    """Extract first JSON object/array from a string."""
    m = _JSON_RE.search(text.strip())
    if not m:
        raise ValueError("No JSON found in model output")
    return json.loads(m.group(1))


class GeminiPlanner:
    """LLM planner using Gemini Robotics-ER 1.5 (preview) via REST.

    Model docs: https://ai.google.dev/gemini-api/docs/robotics-overview
    """

    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.model = settings.gemini_model
        self.timeout_s = settings.gemini_timeout_s

    async def propose(
        self,
        telemetry: Dict[str, Any],
        goal: Dict[str, float],
        nl_task: str,
        last_governance: Optional[Dict[str, Any]] = None,
    ) -> ActionProposal:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

        # Keep it stable and predictable: constrain output to ONE action proposal.
        prompt = f"""You are the high-level reasoning layer for a simulated mobile robot.

TASK:
{nl_task}

WORLD STATE (telemetry JSON):
{json.dumps(telemetry, indent=2)}

GOAL:
{json.dumps(goal)}

INSTRUCTIONS:
- Propose exactly ONE next action.
- Allowed intents: MOVE_TO, STOP, WAIT.
- For MOVE_TO, output params: {{"x": <float>, "y": <float>, "max_speed": <float 0.1..1.0>}}
- If human_detected=true or nearest_obstacle_m is low, reduce max_speed.
- Output STRICT JSON (no markdown) in this schema:

{{"intent":"MOVE_TO|STOP|WAIT","params":{{...}},"rationale":"..."}}
"""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                # keep latency low, reasoning deterministic
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            r = await client.post(url, headers=headers, json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"Gemini error {r.status_code}: {r.text[:400]}")
            data = r.json()

        # Gemini returns candidates[].content.parts[].text
        text = ""
        try:
            text = data["candidates"][0]["content"]["parts"][0].get("text", "")
        except Exception:
            text = json.dumps(data)[:800]

        obj = _extract_json(text)
        proposal = ActionProposal(**obj)

        # Safety clamp for MVP
        if proposal.intent == "MOVE_TO":
            p = proposal.params or {}
            p["x"] = float(p.get("x", goal.get("x", 0)))
            p["y"] = float(p.get("y", goal.get("y", 0)))
            p["max_speed"] = float(p.get("max_speed", 0.5))
            p["max_speed"] = max(0.1, min(1.0, p["max_speed"]))
            proposal.params = p

        return proposal

    async def generate_plan(
        self,
        telemetry: Dict[str, Any],
        instruction: str,
        goal: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """Generate a multi-waypoint plan from a natural-language instruction.

        Returns a dict with:
          - waypoints: [{x, y, max_speed}, ...]
          - rationale: str
          - estimated_time_s: float
        """
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

        goal_text = f"GOAL: {json.dumps(goal)}" if goal else "No specific coordinate goal."

        prompt = f"""You are the high-level reasoning layer for a simulated mobile robot
operating in a warehouse with a 30×20m geofence, obstacles, and a human worker.

INSTRUCTION FROM OPERATOR:
{instruction}

CURRENT STATE (telemetry JSON):
{json.dumps(telemetry, indent=2)}

{goal_text}

CONSTRAINTS:
- Max speed 0.1–1.0 m/s
- Reduce speed near humans/obstacles
- Stay within geofence (0-30 x, 0-20 y)
- Allowed intents per waypoint: MOVE_TO, STOP, WAIT

Generate a MULTI-WAYPOINT plan as STRICT JSON (no markdown):

{{
  "waypoints": [
    {{"x": <float>, "y": <float>, "max_speed": <float>}},
    ...
  ],
  "rationale": "<short explanation of the plan>",
  "estimated_time_s": <float>
}}

Keep the plan to 2-6 waypoints. The last waypoint should be the final destination.
"""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            r = await client.post(url, headers=headers, json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"Gemini error {r.status_code}: {r.text[:400]}")
            data = r.json()

        text = ""
        try:
            text = data["candidates"][0]["content"]["parts"][0].get("text", "")
        except Exception:
            text = json.dumps(data)[:800]

        obj = _extract_json(text)

        # Validate & clamp waypoints
        waypoints = obj.get("waypoints", [])
        for wp in waypoints:
            wp["x"] = max(0.0, min(30.0, float(wp.get("x", 0))))
            wp["y"] = max(0.0, min(20.0, float(wp.get("y", 0))))
            wp["max_speed"] = max(0.1, min(1.0, float(wp.get("max_speed", 0.5))))

        return {
            "waypoints": waypoints,
            "rationale": str(obj.get("rationale", "")),
            "estimated_time_s": float(obj.get("estimated_time_s", 0)),
        }
