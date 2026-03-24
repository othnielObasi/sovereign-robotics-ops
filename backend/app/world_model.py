from __future__ import annotations

"""Unified world model — single source of truth for geofence, zone limits, etc.

Loads constants from sim/mock_sim/world.json so that the policy engine,
planners, and simulator all share the same boundary definitions.
Falls back to hardcoded defaults if world.json is unavailable.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger("app.world_model")

# Locate world.json: repo_root/sim/mock_sim/world.json
_HERE = Path(__file__).resolve().parent  # backend/app/
_REPO_ROOT = _HERE.parent.parent  # backend/../ = repo root
_WORLD_PATH = _REPO_ROOT / "sim" / "mock_sim" / "world.json"

# Defaults matching the hardcoded values that existed before unification
_DEFAULT_GEOFENCE = {"min_x": 0.0, "max_x": 40.0, "min_y": 0.0, "max_y": 25.0}
_DEFAULT_ZONES: List[Dict[str, Any]] = []
_DEFAULT_BAYS: List[Dict[str, Any]] = []

_world: Dict[str, Any] = {}

try:
    with _WORLD_PATH.open("r", encoding="utf-8") as f:
        _world = json.load(f)
    logger.info("Loaded world model from %s", _WORLD_PATH)
except Exception as e:
    logger.warning("Could not load world.json (%s), using defaults", e)

GEOFENCE: Dict[str, float] = {
    k: float(v) for k, v in (_world.get("geofence") or _DEFAULT_GEOFENCE).items()
}

ZONES: List[Dict[str, Any]] = _world.get("zones") or _DEFAULT_ZONES
BAYS: List[Dict[str, Any]] = _world.get("bays") or _DEFAULT_BAYS
OBSTACLES: List[Dict[str, Any]] = _world.get("obstacles") or []

# Zone speed limits — derived from zone names
ZONE_SPEED_LIMITS: Dict[str, float] = {
    "aisle": 0.5,
    "corridor": 0.7,
    "loading_bay": 0.4,
}
