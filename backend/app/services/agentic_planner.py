"""
Agentic Planner — ReAct-style agent with tool use, memory, and replanning.

Unlike the simple GeminiPlanner (single LLM call → JSON), this agent:
1. TOOLS   — Can call check_policy, get_world_state, plan_subpath before proposing
2. MEMORY  — Keeps a sliding window of past decisions + outcomes for learning
3. REACT   — Reason → Act → Observe → repeat  (up to N steps)
4. REPLAN  — On governance denial, feeds reason back and generates new strategy
5. DECOMPOSE — Breaks complex tasks into ordered sub-goals
6. AUDIT   — Full chain-of-thought captured for compliance (ISO 42001)
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.config import settings
from app.schemas.governance import ActionProposal, GovernanceDecision

logger = logging.getLogger("app.agentic_planner")


# ─── Tool definitions (what the agent can "call") ──────────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "check_policy",
        "description": "Pre-check whether a proposed action would pass governance policies. Returns the predicted decision (APPROVED/DENIED/NEEDS_REVIEW) and any policy hits.",
        "parameters": {
            "intent": "MOVE_TO|STOP|WAIT",
            "x": "float — target x coordinate",
            "y": "float — target y coordinate",
            "max_speed": "float — proposed speed (0.1-1.0)",
        },
    },
    {
        "name": "get_world_state",
        "description": "Get current environment state: robot position, human positions, obstacle positions, zone info, geofence boundaries.",
        "parameters": {},
    },
    {
        "name": "calculate_distance",
        "description": "Calculate distance between two points and check if path is clear of obstacles.",
        "parameters": {
            "from_x": "float",
            "from_y": "float",
            "to_x": "float",
            "to_y": "float",
        },
    },
    {
        "name": "decompose_task",
        "description": "Break a high-level instruction into ordered sub-goals. Use this for complex multi-step tasks.",
        "parameters": {
            "instruction": "string — the high-level task",
        },
    },
    {
        "name": "submit_action",
        "description": "Submit your final action proposal. Call this when you've finished reasoning and are ready to act.",
        "parameters": {
            "intent": "MOVE_TO|STOP|WAIT",
            "x": "float (if MOVE_TO)",
            "y": "float (if MOVE_TO)",
            "max_speed": "float (if MOVE_TO, 0.1-1.0)",
            "rationale": "string — explain your reasoning",
        },
    },
]


# ─── Memory entry ──────────────────────────────────────────────────────────

@dataclass
class MemoryEntry:
    """Single memory item: what was proposed, what happened, and why."""
    timestamp: float
    proposal_intent: str
    proposal_params: Dict[str, Any]
    governance_decision: str  # APPROVED / DENIED / NEEDS_REVIEW
    policy_hits: List[str]
    reasons: List[str]
    policy_state: str
    was_executed: bool

    def to_text(self) -> str:
        hits = ", ".join(self.policy_hits) if self.policy_hits else "none"
        reasons_str = "; ".join(self.reasons) if self.reasons else "none"
        return (
            f"- Proposed {self.proposal_intent} {self.proposal_params} → "
            f"{self.governance_decision} (policies: {hits}). "
            f"Reasons: {reasons_str}. Executed: {self.was_executed}."
        )


@dataclass
class ThoughtStep:
    """One step in the agent's chain of thought."""
    step_number: int
    thought: str
    action: Optional[str] = None
    action_input: Optional[Dict[str, Any]] = None
    observation: Optional[str] = None


# ─── Tool execution (server-side, no LLM needed) ──────────────────────────

class ToolExecutor:
    """Execute agent tool calls against live environment state."""

    def __init__(self, telemetry: Dict[str, Any], world: Optional[Dict[str, Any]] = None):
        self.telemetry = telemetry
        self.world = world or {}

    def execute(self, tool_name: str, params: Dict[str, Any]) -> str:
        """Run a tool and return observation text."""
        fn = getattr(self, f"_tool_{tool_name}", None)
        if not fn:
            return f"Unknown tool: {tool_name}"
        try:
            return fn(params)
        except Exception as e:
            return f"Tool error: {e}"

    def _tool_check_policy(self, params: Dict[str, Any]) -> str:
        """Pre-check policy without actually executing."""
        from app.policies.rules_python import evaluate_policies

        proposal = ActionProposal(
            intent=params.get("intent", "MOVE_TO"),
            params={
                "x": float(params.get("x", 0)),
                "y": float(params.get("y", 0)),
                "max_speed": float(params.get("max_speed", 0.5)),
            },
            rationale="Policy pre-check",
        )
        decision = evaluate_policies(self.telemetry, proposal)
        hits = ", ".join(decision.policy_hits) if decision.policy_hits else "none"
        reasons = "; ".join(decision.reasons) if decision.reasons else "none"
        return (
            f"Decision: {decision.decision}. "
            f"Policy hits: {hits}. "
            f"Risk score: {decision.risk_score:.2f}. "
            f"Policy state: {decision.policy_state}. "
            f"Reasons: {reasons}."
        )

    def _tool_get_world_state(self, params: Dict[str, Any]) -> str:
        """Return current environment state."""
        t = self.telemetry
        parts = [
            f"Robot position: ({t.get('x', '?')}, {t.get('y', '?')})",
            f"Robot speed: {t.get('speed', '?')} m/s",
            f"Robot heading: {t.get('theta', '?')} rad",
            f"Zone: {t.get('zone', '?')}",
            f"Nearest obstacle: {t.get('nearest_obstacle_m', '?')}m",
            f"Human detected: {t.get('human_detected', False)}",
            f"Human distance: {t.get('human_distance_m', '?')}m",
            f"Human confidence: {t.get('human_conf', '?')}",
        ]
        # Add world info if available
        geo = self.world.get("geofence", {})
        if geo:
            parts.append(f"Geofence: x[{geo.get('min_x', 0)}-{geo.get('max_x', 30)}], y[{geo.get('min_y', 0)}-{geo.get('max_y', 20)}]")
        zones = self.world.get("zones", [])
        if zones:
            zone_strs = [f"{z['name']}(y:{z['rect']['min_y']}-{z['rect']['max_y']})" for z in zones if "rect" in z]
            parts.append(f"Zones: {', '.join(zone_strs)}")
        obstacles = self.world.get("obstacles", [])
        if obstacles:
            obs_strs = [f"({o['x']},{o['y']})" for o in obstacles]
            parts.append(f"Obstacles at: {', '.join(obs_strs)}")
        human = self.world.get("human")
        if human:
            parts.append(f"Human at: ({human.get('x', '?')}, {human.get('y', '?')})")
        return "\n".join(parts)

    def _tool_calculate_distance(self, params: Dict[str, Any]) -> str:
        """Calculate distance and check for obstacles along path."""
        fx, fy = float(params.get("from_x", 0)), float(params.get("from_y", 0))
        tx, ty = float(params.get("to_x", 0)), float(params.get("to_y", 0))
        d = math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2)

        # Simple obstacle proximity check along the line
        obstacles = self.world.get("obstacles", [])
        blocked = False
        blocking_obs = None
        for ob in obstacles:
            ox, oy = float(ob["x"]), float(ob["y"])
            # Point-to-line-segment distance
            dx, dy = tx - fx, ty - fy
            seg_len_sq = dx * dx + dy * dy
            if seg_len_sq < 1e-6:
                obs_dist = math.sqrt((ox - fx) ** 2 + (oy - fy) ** 2)
            else:
                t_param = max(0, min(1, ((ox - fx) * dx + (oy - fy) * dy) / seg_len_sq))
                proj_x = fx + t_param * dx
                proj_y = fy + t_param * dy
                obs_dist = math.sqrt((ox - proj_x) ** 2 + (oy - proj_y) ** 2)
            if obs_dist < 1.5:  # within 1.5m of path
                blocked = True
                blocking_obs = (ox, oy, obs_dist)

        result = f"Distance: {d:.2f}m."
        if blocked and blocking_obs:
            result += f" WARNING: Obstacle at ({blocking_obs[0]}, {blocking_obs[1]}) is {blocking_obs[2]:.1f}m from path — may cause denial."
        else:
            result += " Path appears clear of obstacles."
        return result

    def _tool_decompose_task(self, params: Dict[str, Any]) -> str:
        """Break instruction into sub-goals (deterministic heuristic)."""
        instruction = params.get("instruction", "").lower()
        rx, ry = float(self.telemetry.get("x", 0)), float(self.telemetry.get("y", 0))

        sub_goals = []
        # Loading bay is y > 12
        if "bay" in instruction or "loading" in instruction:
            if ry < 12:
                sub_goals.append("1. Navigate through aisle to y=12 boundary (stay in clear corridor)")
                sub_goals.append("2. Cross into loading bay zone (reduce speed to 0.4 m/s)")
                sub_goals.append("3. Approach target position in loading bay")
                sub_goals.append("4. STOP at destination")
            else:
                sub_goals.append("1. Navigate to target position in loading bay")
                sub_goals.append("2. STOP at destination")
        elif "avoid" in instruction or "around" in instruction:
            sub_goals.append("1. Check obstacle and human positions")
            sub_goals.append("2. Plan waypoints that maintain >1.5m clearance from all obstacles")
            sub_goals.append("3. Reduce speed near humans (<0.4 m/s within 3m)")
            sub_goals.append("4. Navigate via waypoints to target")
            sub_goals.append("5. STOP at destination")
        else:
            sub_goals.append("1. Check current environment for hazards")
            sub_goals.append("2. Plan direct path to goal")
            sub_goals.append("3. Navigate to goal with safe speed")
            sub_goals.append("4. STOP at destination")

        return "Sub-goals:\n" + "\n".join(sub_goals)


# ─── Agent Memory ──────────────────────────────────────────────────────────

class AgentMemory:
    """Sliding window of past decisions and outcomes."""

    def __init__(self, max_entries: int = 20):
        self.entries: List[MemoryEntry] = []
        self.max_entries = max_entries

    def add(self, entry: MemoryEntry) -> None:
        self.entries.append(entry)
        if len(self.entries) > self.max_entries:
            self.entries = self.entries[-self.max_entries:]

    def to_context(self) -> str:
        if not self.entries:
            return "No previous decisions."
        lines = [e.to_text() for e in self.entries[-8:]]  # last 8 for prompt size
        return "Recent decision history:\n" + "\n".join(lines)

    def denial_count(self, last_n: int = 5) -> int:
        recent = self.entries[-last_n:]
        return sum(1 for e in recent if e.governance_decision in ("DENIED", "NEEDS_REVIEW"))

    def last_denial_reasons(self) -> List[str]:
        for e in reversed(self.entries):
            if e.governance_decision in ("DENIED", "NEEDS_REVIEW"):
                return e.reasons
        return []


# ─── Agentic Planner ──────────────────────────────────────────────────────

class AgenticPlanner:
    """
    ReAct-style agentic planner that reasons, uses tools, and replans.

    The agent runs a multi-step reasoning loop:
    1. Receives task + environment state + memory
    2. Reasons about what to do (THOUGHT)
    3. Calls a tool (ACTION) — check_policy, get_world_state, calculate_distance, decompose_task
    4. Observes the result (OBSERVATION)
    5. Repeats steps 2-4 until it calls submit_action
    6. If governance denies, feeds denial reason back and replans (up to MAX_REPLAN attempts)
    """

    MAX_STEPS = 6       # max reasoning steps per attempt
    MAX_REPLANS = 2     # max times to replan after denial

    def __init__(self):
        from app.services.gemini_planner import GeminiPlanner
        self._llm = GeminiPlanner()
        self.memory = AgentMemory()

    def _build_system_prompt(
        self,
        telemetry: Dict[str, Any],
        goal: Dict[str, float],
        nl_task: str,
        world: Optional[Dict[str, Any]] = None,
        denial_feedback: Optional[str] = None,
    ) -> str:
        """Build the ReAct system prompt with tools, memory, and context."""
        tool_text = "\n".join(
            f"  - {t['name']}: {t['description']} Params: {json.dumps(t['parameters'])}"
            for t in TOOL_DEFINITIONS
        )
        memory_text = self.memory.to_context()
        denial_text = ""
        if denial_feedback:
            denial_text = f"""
IMPORTANT — YOUR PREVIOUS PROPOSAL WAS DENIED:
{denial_feedback}
You MUST propose a DIFFERENT action that avoids the denied policies. Do NOT repeat the same proposal.
Consider: different route, lower speed, waiting, or requesting a human override.
"""

        return f"""You are an autonomous warehouse robot AI agent with tool-use capabilities.

YOUR TASK: {nl_task}
GOAL: Navigate to ({goal.get('x', '?')}, {goal.get('y', '?')})

CURRENT STATE:
- Position: ({telemetry.get('x', '?')}, {telemetry.get('y', '?')})
- Speed: {telemetry.get('speed', 0)} m/s
- Zone: {telemetry.get('zone', '?')}
- Human detected: {telemetry.get('human_detected', False)} (distance: {telemetry.get('human_distance_m', '?')}m)
- Nearest obstacle: {telemetry.get('nearest_obstacle_m', '?')}m

MEMORY (learn from past decisions):
{memory_text}
{denial_text}
AVAILABLE TOOLS:
{tool_text}

POLICY RULES TO RESPECT:
- Geofence: x[0-30], y[0-20] — STOP if outside
- Aisle zone (y<12): max speed 0.5 m/s
- Loading bay (y>12): max speed 0.4 m/s
- Human within 1m: FULL STOP
- Human within 3m: max speed 0.4 m/s
- Obstacle clearance: minimum 0.5m

INSTRUCTIONS:
Use the ReAct pattern: Think, then use a tool, observe the result, repeat.
You MUST use check_policy before submitting any MOVE_TO action.
When ready, call submit_action with your final decision.

OUTPUT FORMAT — Respond with a JSON array of reasoning steps:
[
  {{"thought": "I need to check where the human is...", "action": "get_world_state", "action_input": {{}}}},
  {{"thought": "The human is 2.5m away, I should slow down...", "action": "check_policy", "action_input": {{"intent": "MOVE_TO", "x": 15, "y": 10, "max_speed": 0.4}}}},
  {{"thought": "Policy check passed. I'll submit this action.", "action": "submit_action", "action_input": {{"intent": "MOVE_TO", "x": 15, "y": 10, "max_speed": 0.4, "rationale": "Moving to goal at reduced speed due to nearby human."}}}}
]

RULES:
- ALWAYS check_policy before submit_action for MOVE_TO
- Use calculate_distance to verify paths are clear
- If near a human (<3m), reduce max_speed to 0.4
- If near a human (<1m), use STOP intent
- Maximum {self.MAX_STEPS} reasoning steps
- You MUST end with submit_action
"""

    async def propose(
        self,
        telemetry: Dict[str, Any],
        goal: Dict[str, float],
        nl_task: str,
        last_governance: Optional[Dict[str, Any]] = None,
        world: Optional[Dict[str, Any]] = None,
    ) -> tuple[ActionProposal, List[ThoughtStep], str]:
        """
        Run the agentic reasoning loop.

        Returns:
            (proposal, thought_chain, model_used)
        """
        denial_feedback = None

        # If last governance was a denial, include it as feedback
        if last_governance and last_governance.get("decision") in ("DENIED", "NEEDS_REVIEW"):
            hits = ", ".join(last_governance.get("policy_hits", []))
            reasons = "; ".join(last_governance.get("reasons", []))
            denial_feedback = f"Decision: {last_governance['decision']}. Policies: {hits}. Reasons: {reasons}."

        # Check memory for repeated denials
        if self.memory.denial_count(5) >= 3:
            if not denial_feedback:
                denial_feedback = ""
            denial_feedback += f"\nWARNING: {self.memory.denial_count(5)} of last 5 proposals were denied. Significantly change your strategy."

        all_thoughts: List[ThoughtStep] = []
        model_used = "unknown"

        for replan_attempt in range(self.MAX_REPLANS + 1):
            prompt = self._build_system_prompt(telemetry, goal, nl_task, world, denial_feedback)

            # Call LLM
            result_text = None
            for model in self._llm._get_cascade():
                logger.info(f"[Agentic] Trying {model} (attempt {replan_attempt + 1})")
                result_text = await self._llm._call_gemini(model, prompt)
                if result_text:
                    model_used = model
                    break

            if not result_text:
                logger.warning("[Agentic] All models failed, falling back to deterministic")
                return self._deterministic_fallback(telemetry, goal, denial_feedback), all_thoughts, "deterministic"

            # Parse reasoning steps
            try:
                from app.services.gemini_planner import _extract_json
                steps_raw = _extract_json(result_text)
                if isinstance(steps_raw, dict):
                    steps_raw = [steps_raw]
            except Exception as e:
                logger.warning(f"[Agentic] Failed to parse reasoning steps: {e}")
                return self._deterministic_fallback(telemetry, goal, denial_feedback), all_thoughts, model_used

            # Execute reasoning chain with tools
            tool_exec = ToolExecutor(telemetry, world)
            proposal = None

            for i, step_raw in enumerate(steps_raw[:self.MAX_STEPS]):
                thought = step_raw.get("thought", "")
                action = step_raw.get("action", "")
                action_input = step_raw.get("action_input", {})

                step = ThoughtStep(
                    step_number=len(all_thoughts) + 1,
                    thought=thought,
                    action=action,
                    action_input=action_input,
                )

                if action == "submit_action":
                    # Final action
                    intent = action_input.get("intent", "MOVE_TO")
                    params = {}
                    if intent == "MOVE_TO":
                        params = {
                            "x": max(0.0, min(30.0, float(action_input.get("x", goal.get("x", 0))))),
                            "y": max(0.0, min(20.0, float(action_input.get("y", goal.get("y", 0))))),
                            "max_speed": max(0.1, min(1.0, float(action_input.get("max_speed", 0.5)))),
                        }
                    rationale = action_input.get("rationale", "Agent-generated action")
                    proposal = ActionProposal(
                        intent=intent,
                        params=params,
                        rationale=f"[{model_used}/agentic] {rationale}",
                    )
                    step.observation = f"Action submitted: {intent} {params}"
                else:
                    # Execute tool and capture observation
                    observation = tool_exec.execute(action, action_input or {})
                    step.observation = observation

                all_thoughts.append(step)

                if proposal:
                    break

            if not proposal:
                # Agent didn't call submit_action — fallback
                logger.warning("[Agentic] Agent didn't submit an action, using deterministic")
                proposal = self._deterministic_fallback(telemetry, goal, denial_feedback)

            # Pre-check governance before returning
            from app.policies.rules_python import evaluate_policies
            pre_check = evaluate_policies(telemetry, proposal)

            if pre_check.decision == "APPROVED" or replan_attempt >= self.MAX_REPLANS:
                # Either approved or we've exhausted replanning attempts
                return proposal, all_thoughts, model_used

            # Governance would deny — replan with feedback
            hits = ", ".join(pre_check.policy_hits)
            reasons = "; ".join(pre_check.reasons)
            denial_feedback = (
                f"Pre-check DENIED (attempt {replan_attempt + 1}): "
                f"Policies: {hits}. Reasons: {reasons}. "
                f"Risk: {pre_check.risk_score:.2f}. State: {pre_check.policy_state}."
            )
            logger.info(f"[Agentic] Pre-check denied, replanning: {denial_feedback}")

            # Add a replan thought step
            all_thoughts.append(ThoughtStep(
                step_number=len(all_thoughts) + 1,
                thought=f"My proposal was pre-denied. Replanning with feedback: {denial_feedback}",
                action="replan",
                observation="Starting new reasoning chain...",
            ))

        return proposal, all_thoughts, model_used

    def record_outcome(
        self,
        proposal: ActionProposal,
        governance: GovernanceDecision,
        was_executed: bool,
    ) -> None:
        """Record the outcome of a proposal for future learning."""
        self.memory.add(MemoryEntry(
            timestamp=time.time(),
            proposal_intent=proposal.intent,
            proposal_params=proposal.params or {},
            governance_decision=governance.decision,
            policy_hits=governance.policy_hits,
            reasons=governance.reasons,
            policy_state=governance.policy_state,
            was_executed=was_executed,
        ))

    def _deterministic_fallback(
        self,
        telemetry: Dict[str, Any],
        goal: Dict[str, float],
        denial_feedback: Optional[str] = None,
    ) -> ActionProposal:
        """Smart deterministic fallback that respects denial history."""
        x = float(telemetry.get("x", 0))
        y = float(telemetry.get("y", 0))
        gx = float(goal.get("x", 0))
        gy = float(goal.get("y", 0))

        if abs(x - gx) < 0.5 and abs(y - gy) < 0.5:
            return ActionProposal(intent="STOP", params={}, rationale="[agentic/fallback] Reached goal.")

        speed = 0.5
        human_d = float(telemetry.get("human_distance_m", 999))
        if human_d < 1.0:
            return ActionProposal(intent="STOP", params={}, rationale="[agentic/fallback] Human too close, stopping.")
        if human_d < 3.0:
            speed = 0.3

        # If repeatedly denied, try lower speed
        if self.memory.denial_count(5) >= 2:
            speed = min(speed, 0.3)

        zone = telemetry.get("zone", "aisle")
        zone_limits = {"aisle": 0.5, "loading_bay": 0.4, "corridor": 0.7}
        speed = min(speed, zone_limits.get(zone, 0.5))

        return ActionProposal(
            intent="MOVE_TO",
            params={"x": gx, "y": gy, "max_speed": speed},
            rationale=f"[agentic/fallback] Safe navigation at {speed:.1f} m/s (zone: {zone}).",
        )

    def get_memory_summary(self) -> Dict[str, Any]:
        """Return memory state for API/UI inspection."""
        return {
            "total_entries": len(self.memory.entries),
            "recent_denials": self.memory.denial_count(5),
            "entries": [
                {
                    "intent": e.proposal_intent,
                    "params": e.proposal_params,
                    "decision": e.governance_decision,
                    "policy_hits": e.policy_hits,
                    "executed": e.was_executed,
                }
                for e in self.memory.entries[-10:]
            ],
        }
