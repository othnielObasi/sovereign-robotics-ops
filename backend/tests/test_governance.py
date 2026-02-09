from app.policies.rules_python import evaluate_policies
from app.schemas.governance import ActionProposal


def test_policy_denies_speed_in_aisle():
    telemetry = {"x": 1, "y": 1, "zone": "aisle", "nearest_obstacle_m": 2.0, "human_detected": False, "human_conf": 0.0}
    proposal = ActionProposal(intent="MOVE_TO", params={"x": 10, "y": 10, "max_speed": 0.9})
    decision = evaluate_policies(telemetry, proposal)
    assert decision.decision in ("DENIED", "NEEDS_REVIEW")
    assert "SAFE_SPEED_01" in decision.policy_hits
