from __future__ import annotations

"""Policy versioning — compute a deterministic hash of the active policy set.

Used to tag every governance decision with the exact policy configuration
that was in effect, enabling reproducibility and regulatory traceability.
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Dict

from app.policies.rules_python import (
    GEOFENCE,
    ZONE_SPEED_LIMITS,
    MIN_OBSTACLE_CLEARANCE_M,
    MIN_HUMAN_CONF,
    MAX_SPEED_NEAR_HUMAN,
    MIN_CONF_FOR_MOVE,
    HUMAN_SLOW_RADIUS_M,
    HUMAN_STOP_RADIUS_M,
    REVIEW_RISK_THRESHOLD,
)

# Singleton cache
_cached_version: str | None = None
_cached_params: Dict[str, Any] | None = None


def _policy_params() -> Dict[str, Any]:
    """Collect all active policy parameters into a canonical dict."""
    return {
        "GEOFENCE": GEOFENCE,
        "ZONE_SPEED_LIMITS": ZONE_SPEED_LIMITS,
        "MIN_OBSTACLE_CLEARANCE_M": MIN_OBSTACLE_CLEARANCE_M,
        "MIN_HUMAN_CONF": MIN_HUMAN_CONF,
        "MAX_SPEED_NEAR_HUMAN": MAX_SPEED_NEAR_HUMAN,
        "MIN_CONF_FOR_MOVE": MIN_CONF_FOR_MOVE,
        "HUMAN_SLOW_RADIUS_M": HUMAN_SLOW_RADIUS_M,
        "HUMAN_STOP_RADIUS_M": HUMAN_STOP_RADIUS_M,
        "REVIEW_RISK_THRESHOLD": REVIEW_RISK_THRESHOLD,
    }


def policy_version_hash() -> str:
    """Return a short SHA256 hex digest of the active policy parameters.

    This is deterministic for a given set of constants — changing any
    parameter changes the hash, making it trivial to detect drift.
    """
    global _cached_version, _cached_params
    params = _policy_params()
    if _cached_params == params and _cached_version is not None:
        return _cached_version
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
    _cached_version = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    _cached_params = params
    return _cached_version


def policy_version_info() -> Dict[str, Any]:
    """Return the full version info: hash + all active parameters."""
    return {
        "version_hash": policy_version_hash(),
        "parameters": _policy_params(),
    }
