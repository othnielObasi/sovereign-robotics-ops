from __future__ import annotations

from typing import Dict, Any, Tuple, List
from app.schemas.governance import GovernanceDecision, ActionProposal


# --- Policy parameters (MVP constants) ---
GEOFENCE = {"min_x": 0.0, "max_x": 30.0, "min_y": 0.0, "max_y": 20.0}

ZONE_SPEED_LIMITS = {
    "aisle": 0.5,
    "corridor": 0.7,
    "loading_bay": 0.4,
}

MIN_OBSTACLE_CLEARANCE_M = 0.5
MIN_HUMAN_CONF = 0.65
MAX_SPEED_NEAR_HUMAN = 0.4
MIN_CONF_FOR_MOVE = 0.55

REVIEW_RISK_THRESHOLD = 0.75


def evaluate_policies(telemetry: Dict[str, Any], proposal: ActionProposal) -> GovernanceDecision:
    """Evaluate a proposal against a small policy set.

    Returns an APPROVED / DENIED / NEEDS_REVIEW decision with reasons.
    """
    policy_hits: List[str] = []
    reasons: List[str] = []
    required_action: str | None = None

    # Risk score is a simple heuristic (0..1) for demo purposes
    risk_score = 0.0

    x = float(telemetry.get("x", 0.0))
    y = float(telemetry.get("y", 0.0))
    zone = telemetry.get("zone", "aisle")
    nearest_obstacle_m = float(telemetry.get("nearest_obstacle_m", 999.0))
    human_detected = bool(telemetry.get("human_detected", False))
    human_conf = float(telemetry.get("human_conf", 0.0))

    intent = proposal.intent
    params = proposal.params or {}
    max_speed = float(params.get("max_speed", 0.0)) if intent == "MOVE_TO" else 0.0

    # --- GEOFENCE_01 ---
    if not (GEOFENCE["min_x"] <= x <= GEOFENCE["max_x"] and GEOFENCE["min_y"] <= y <= GEOFENCE["max_y"]):
        policy_hits.append("GEOFENCE_01")
        reasons.append(f"Robot out of geofence at ({x:.2f},{y:.2f}).")
        risk_score = max(risk_score, 0.95)

    # --- OBSTACLE_CLEARANCE_03 ---
    if intent == "MOVE_TO" and nearest_obstacle_m < MIN_OBSTACLE_CLEARANCE_M:
        policy_hits.append("OBSTACLE_CLEARANCE_03")
        reasons.append(f"Obstacle clearance too low: {nearest_obstacle_m:.2f}m < {MIN_OBSTACLE_CLEARANCE_M:.2f}m.")
        required_action = "Stop or replan with safer clearance."
        risk_score = max(risk_score, 0.9)

    # --- UNCERTAINTY_04 ---
    if intent == "MOVE_TO" and human_detected and human_conf < MIN_HUMAN_CONF:
        policy_hits.append("UNCERTAINTY_04")
        reasons.append(f"Human detected but confidence too low: {human_conf:.2f} < {MIN_HUMAN_CONF:.2f}.")
        required_action = "Slow down and request operator review; improve perception confidence."
        risk_score = max(risk_score, 0.8)

    # --- SAFE_SPEED_01 ---
    if intent == "MOVE_TO":
        limit = float(ZONE_SPEED_LIMITS.get(zone, 0.5))
        if max_speed > limit:
            policy_hits.append("SAFE_SPEED_01")
            reasons.append(f"Speed too high for zone '{zone}': {max_speed:.2f} > {limit:.2f}.")
            required_action = f"Reduce max_speed to <= {limit:.2f}."
            risk_score = max(risk_score, 0.85)

    # --- HUMAN_CLEARANCE_02 ---
    if intent == "MOVE_TO" and human_detected and human_conf >= MIN_HUMAN_CONF:
        if max_speed > MAX_SPEED_NEAR_HUMAN:
            policy_hits.append("HUMAN_CLEARANCE_02")
            reasons.append(f"Human nearby (conf={human_conf:.2f}); max_speed {max_speed:.2f} too high.")
            required_action = f"Reduce max_speed to <= {MAX_SPEED_NEAR_HUMAN:.2f} near humans."
            risk_score = max(risk_score, 0.88)

    # --- MIN_CONF_FOR_MOVE (part of uncertainty) ---
    if intent == "MOVE_TO" and telemetry.get("human_detected") and human_conf < MIN_CONF_FOR_MOVE:
        risk_score = max(risk_score, 0.7)

    # Decision logic
    if policy_hits:
        # If high risk, request review rather than simple denial for demo richness
        if risk_score >= REVIEW_RISK_THRESHOLD and "GEOFENCE_01" not in policy_hits:
            return GovernanceDecision(
                decision="NEEDS_REVIEW",
                policy_hits=policy_hits,
                reasons=reasons,
                required_action=required_action,
                risk_score=risk_score,
            )
        return GovernanceDecision(
            decision="DENIED",
            policy_hits=policy_hits,
            reasons=reasons,
            required_action=required_action,
            risk_score=risk_score,
        )

    return GovernanceDecision(
        decision="APPROVED",
        policy_hits=[],
        reasons=[],
        required_action=None,
        risk_score=risk_score,
    )
