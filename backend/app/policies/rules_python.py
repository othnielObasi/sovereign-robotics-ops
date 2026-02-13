from __future__ import annotations

from typing import Dict, Any, Tuple, List
from app.schemas.governance import GovernanceDecision, ActionProposal


# --- Policy parameters (MVP constants) ---
GEOFENCE = {"min_x": 0.0, "max_x": 40.0, "min_y": 0.0, "max_y": 25.0}

ZONE_SPEED_LIMITS = {
    "aisle": 0.5,
    "corridor": 0.7,
    "loading_bay": 0.4,
}

MIN_OBSTACLE_CLEARANCE_M = 0.5
MIN_HUMAN_CONF = 0.65
MAX_SPEED_NEAR_HUMAN = 0.4
MIN_CONF_FOR_MOVE = 0.55

# Distance-based human proximity thresholds (Fix 2)
HUMAN_SLOW_RADIUS_M = 3.0   # slow down when human within this range
HUMAN_STOP_RADIUS_M = 1.0   # full stop when human within this range

REVIEW_RISK_THRESHOLD = 0.75


def evaluate_policies(telemetry: Dict[str, Any], proposal: ActionProposal) -> GovernanceDecision:
    """Evaluate a proposal against a small policy set.

    Returns an APPROVED / DENIED / NEEDS_REVIEW decision with reasons
    and an explicit policy_state (SAFE / SLOW / STOP / REPLAN).
    """
    policy_hits: List[str] = []
    reasons: List[str] = []
    required_action: str | None = None
    # Explicit safety state for the UI
    policy_state: str = "SAFE"

    # Risk score is a simple heuristic (0..1) for demo purposes
    risk_score = 0.0

    x = float(telemetry.get("x", 0.0))
    y = float(telemetry.get("y", 0.0))
    zone = telemetry.get("zone", "aisle")
    nearest_obstacle_m = float(telemetry.get("nearest_obstacle_m", 999.0))
    human_detected = bool(telemetry.get("human_detected", False))
    human_conf = float(telemetry.get("human_conf", 0.0))
    human_distance_m = float(telemetry.get("human_distance_m", 999.0))

    # Consider walking humans (workers) separately if provided by telemetry
    walking_humans = telemetry.get("walking_humans", []) or []
    nearest_worker_dist = 999.0
    nearest_worker_conf = 0.0
    for wh in walking_humans:
        try:
            wd = float(wh.get("x", 0))
            wd_y = float(wh.get("y", 0))
            d = ((wd - x) ** 2 + (wd_y - y) ** 2) ** 0.5
            if d < nearest_worker_dist:
                nearest_worker_dist = d
                nearest_worker_conf = float(wh.get("conf", 0.9))
        except Exception:
            continue

    intent = proposal.intent
    params = proposal.params or {}
    max_speed = float(params.get("max_speed", 0.0)) if intent == "MOVE_TO" else 0.0

    # --- GEOFENCE_01 ---
    if not (GEOFENCE["min_x"] <= x <= GEOFENCE["max_x"] and GEOFENCE["min_y"] <= y <= GEOFENCE["max_y"]):
        policy_hits.append("GEOFENCE_01")
        reasons.append(f"Robot out of geofence at ({x:.2f},{y:.2f}).")
        risk_score = max(risk_score, 0.95)
        policy_state = "STOP"

    # Also check proposed destination
    if intent == "MOVE_TO":
        dest_x = float(params.get("x", x))
        dest_y = float(params.get("y", y))
        if not (GEOFENCE["min_x"] <= dest_x <= GEOFENCE["max_x"] and GEOFENCE["min_y"] <= dest_y <= GEOFENCE["max_y"]):
            if "GEOFENCE_01" not in policy_hits:
                policy_hits.append("GEOFENCE_01")
            reasons.append(f"Proposed destination ({dest_x:.2f},{dest_y:.2f}) is outside geofence.")
            risk_score = max(risk_score, 0.95)
            policy_state = "STOP"

    # --- OBSTACLE_CLEARANCE_03 ---
    if intent == "MOVE_TO" and nearest_obstacle_m < MIN_OBSTACLE_CLEARANCE_M:
        policy_hits.append("OBSTACLE_CLEARANCE_03")
        reasons.append(f"Obstacle clearance too low: {nearest_obstacle_m:.2f}m < {MIN_OBSTACLE_CLEARANCE_M:.2f}m.")
        required_action = "Stop and replan with safer clearance."
        risk_score = max(risk_score, 0.9)
        policy_state = "REPLAN"

    # --- HUMAN / WORKER PROXIMITY ---
    # Prefer worker (walking_humans) proximity if one is nearer; otherwise use primary human
    use_worker = nearest_worker_dist < human_distance_m
    prox_dist = nearest_worker_dist if use_worker else human_distance_m
    prox_conf = nearest_worker_conf if use_worker else human_conf
    prox_label = "worker" if use_worker else "human"

    if intent == "MOVE_TO" and prox_dist < HUMAN_STOP_RADIUS_M:
        policy_key = "WORKER_PROXIMITY_06" if use_worker else "HUMAN_PROXIMITY_02"
        policy_hits.append(policy_key)
        reasons.append(
            f"{prox_label.capitalize()} too close: {prox_dist:.2f}m < stop radius {HUMAN_STOP_RADIUS_M:.1f}m. Full stop required."
        )
        required_action = "Full stop — human within safety perimeter."
        risk_score = max(risk_score, 0.95)
        policy_state = "STOP"

    elif intent == "MOVE_TO" and prox_dist < HUMAN_SLOW_RADIUS_M:
        policy_key = "WORKER_PROXIMITY_06" if use_worker else "HUMAN_PROXIMITY_02"
        policy_hits.append(policy_key)
        reasons.append(
            f"{prox_label.capitalize()} nearby: {prox_dist:.2f}m < slow radius {HUMAN_SLOW_RADIUS_M:.1f}m. Reduce speed."
        )
        required_action = f"Reduce speed to <= {MAX_SPEED_NEAR_HUMAN:.2f} while {prox_label} is within {HUMAN_SLOW_RADIUS_M:.1f}m."
        risk_score = max(risk_score, 0.80)
        if policy_state == "SAFE":
            policy_state = "SLOW"

    # --- UNCERTAINTY_04 ---
    if intent == "MOVE_TO" and human_detected and human_conf < MIN_HUMAN_CONF:
        policy_hits.append("UNCERTAINTY_04")
        reasons.append(f"Human detected but confidence too low: {human_conf:.2f} < {MIN_HUMAN_CONF:.2f}.")
        required_action = "Slow down and request operator review; improve perception confidence."
        risk_score = max(risk_score, 0.8)
        if policy_state == "SAFE":
            policy_state = "SLOW"

    # --- SAFE_SPEED_01 ---
    if intent == "MOVE_TO":
        limit = float(ZONE_SPEED_LIMITS.get(zone, 0.5))
        if max_speed > limit:
            policy_hits.append("SAFE_SPEED_01")
            reasons.append(f"Speed too high for zone '{zone}': {max_speed:.2f} > {limit:.2f}.")
            required_action = f"Reduce max_speed to <= {limit:.2f}."
            risk_score = max(risk_score, 0.85)
            if policy_state == "SAFE":
                policy_state = "SLOW"

    # --- HUMAN_CLEARANCE_02 (confidence-based, legacy) ---
    if intent == "MOVE_TO" and human_detected and human_conf >= MIN_HUMAN_CONF:
        if max_speed > MAX_SPEED_NEAR_HUMAN:
            if "HUMAN_PROXIMITY_02" not in policy_hits:
                policy_hits.append("HUMAN_CLEARANCE_02")
            reasons.append(f"Human nearby (conf={human_conf:.2f}); max_speed {max_speed:.2f} too high.")
            required_action = f"Reduce max_speed to <= {MAX_SPEED_NEAR_HUMAN:.2f} near humans."
            risk_score = max(risk_score, 0.88)
            if policy_state == "SAFE":
                policy_state = "SLOW"

    # --- MIN_CONF_FOR_MOVE (part of uncertainty) ---
    if intent == "MOVE_TO" and telemetry.get("human_detected") and human_conf < MIN_CONF_FOR_MOVE:
        risk_score = max(risk_score, 0.7)

    # --- HITL_05 (Human-in-the-loop trigger) ---
    if risk_score >= REVIEW_RISK_THRESHOLD and not policy_hits:
        policy_hits.append("HITL_05")
        reasons.append(f"Risk score {risk_score:.2f} exceeds review threshold {REVIEW_RISK_THRESHOLD:.2f}; human review required.")

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
                policy_state=policy_state,
            )
        return GovernanceDecision(
            decision="DENIED",
            policy_hits=policy_hits,
            reasons=reasons,
            required_action=required_action,
            risk_score=risk_score,
            policy_state=policy_state,
        )

    return GovernanceDecision(
        decision="APPROVED",
        policy_hits=[],
        reasons=[],
        required_action=None,
        risk_score=risk_score,
        policy_state="SAFE",
    )
