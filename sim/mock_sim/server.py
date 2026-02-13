from __future__ import annotations

"""Mock Simulator

- Maintains a robot state in memory.
- Updates position toward a target goal when it receives MOVE_TO.
- Produces a lightweight "perception" summary:
  - nearest obstacle distance
  - human distance (metres)
  - whether a human is detected (nearby)
  - confidence score (simulated)
- Emits simple events like near_miss when clearance is low.
- Supports deterministic scenario injection via POST /scenario.

This is intentionally simple but realistic enough for a governance/ops demo.
"""

import json
import math
import os
import random
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="SRO Mock Simulator", version="0.1.0")

SIM_TICK_HZ = float(os.getenv("SIM_TICK_HZ", "10"))
DT = 1.0 / max(SIM_TICK_HZ, 1.0)

SIM_TOKEN = os.getenv("SIM_TOKEN", "").strip()


def _require_sim_token(request: Request) -> None:
    """Require X-Sim-Token header if SIM_TOKEN is configured."""
    if not SIM_TOKEN:
        return
    got = (request.headers.get("X-Sim-Token") or "").strip()
    if got != SIM_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized simulator call")


# --- Load world.json relative to this file, not the CWD ---
HERE = Path(__file__).resolve().parent
WORLD_PATH = HERE / "world.json"
with WORLD_PATH.open("r", encoding="utf-8") as f:
    WORLD = json.load(f)

OBSTACLES: List[Dict[str, Any]] = list(WORLD.get("obstacles", []))
HUMAN_DEFAULT = WORLD.get("human", {"x": 14, "y": 7})
ZONES = WORLD.get("zones", [])
GEOFENCE = WORLD.get("geofence", {"min_x": 0, "max_x": 40, "min_y": 0, "max_y": 25})
BAYS = WORLD.get("bays", [])


class Command(BaseModel):
    intent: str = Field(..., description="MOVE_TO|STOP|WAIT")
    params: Dict[str, Any] = Field(default_factory=dict)


class ScenarioRequest(BaseModel):
    scenario: str = Field(
        ..., description="human_approach|human_too_close|path_blocked|clear"
    )


# ---- Mutable human position (can be moved by scenarios) ----
human_pos: Dict[str, float] = dict(HUMAN_DEFAULT)
# Extra obstacles injected by scenarios
extra_obstacles: List[Dict[str, float]] = []

# ---- Additional walking humans (ambient warehouse workers) ----
# Each has a patrol path and walks between waypoints
import copy

class WalkingHuman:
    """A human worker that walks a patrol loop in the warehouse."""

    def __init__(self, name: str, waypoints: List[Dict[str, float]], speed: float = 0.6):
        self.name = name
        self.waypoints = waypoints
        self.speed = speed
        self.pos = dict(waypoints[0])
        self.wp_idx = 0
        self.paused_until = 0.0  # timestamp to pause until (simulates stopping at a shelf)

    def step(self, dt: float) -> None:
        now = time.time()
        if now < self.paused_until:
            return
        tgt = self.waypoints[self.wp_idx]
        dx = tgt["x"] - self.pos["x"]
        dy = tgt["y"] - self.pos["y"]
        d = math.sqrt(dx * dx + dy * dy)
        if d < 0.15:
            # Arrived at waypoint — pause briefly, then move to next
            self.paused_until = now + random.uniform(1.0, 3.0)
            self.wp_idx = (self.wp_idx + 1) % len(self.waypoints)
        else:
            step = min(self.speed * dt, d)
            self.pos["x"] += (dx / d) * step
            self.pos["y"] += (dy / d) * step

    def to_dict(self) -> Dict[str, Any]:
        return {"x": round(self.pos["x"], 2), "y": round(self.pos["y"], 2), "name": self.name, "type": "worker", "conf": 0.9}


# Patrol routes that feel natural for a warehouse
walking_humans: List[WalkingHuman] = [
    WalkingHuman("Worker A", [
        {"x": 6, "y": 5}, {"x": 6, "y": 11}, {"x": 14, "y": 11}, {"x": 14, "y": 5},
    ], speed=0.5),
    WalkingHuman("Worker B", [
        {"x": 25, "y": 16}, {"x": 32, "y": 16}, {"x": 32, "y": 22}, {"x": 25, "y": 22},
    ], speed=0.4),
    WalkingHuman("Forklift Op", [
        {"x": 14, "y": 16}, {"x": 28, "y": 16}, {"x": 28, "y": 20}, {"x": 14, "y": 20},
    ], speed=0.7),
]

# Make the primary human dynamic by turning it into a WalkingHuman
# Primary human will patrol a small square around the default human location.
try:
    _hx = float(HUMAN_DEFAULT.get("x", 14))
    _hy = float(HUMAN_DEFAULT.get("y", 7))
except Exception:
    _hx, _hy = 14.0, 7.0

primary_human = WalkingHuman(
    "Primary Human",
    [
        {"x": _hx, "y": _hy},
        {"x": _hx + 2.0, "y": _hy},
        {"x": _hx + 2.0, "y": _hy + 2.0},
        {"x": _hx, "y": _hy + 2.0},
    ],
    speed=0.45,
)

# Append primary human to walking_humans so it is stepped and included in telemetry
walking_humans.append(primary_human)

# ---- Second robot (idle in loading bay, for visual realism) ----
idle_robots: List[Dict[str, Any]] = [
    {"x": 34.0, "y": 20.0, "theta": 1.57, "speed": 0.0, "label": "R-02 (Idle)", "status": "idle"},
]


state: Dict[str, Any] = {
    "x": 2.0,
    "y": 2.0,
    "theta": 0.0,
    "speed": 0.0,
    "zone": "aisle",
    "nearest_obstacle_m": 999.0,
    "human_detected": False,
    "human_conf": 0.0,
    "human_distance_m": 999.0,
    "events": [],
    "target": None,  # {"x": float, "y": float, "max_speed": float}
    "last_update": time.time(),
}


def _zone_for(x: float, y: float) -> str:
    for z in ZONES:
        r = z["rect"]
        if r["min_x"] <= x <= r["max_x"] and r["min_y"] <= y <= r["max_y"]:
            return z["name"]
    return "aisle"


def _dist(a: Dict[str, Any], x: float, y: float) -> float:
    return math.sqrt((a["x"] - x) ** 2 + (a["y"] - y) ** 2)


def _all_obstacles() -> List[Dict[str, Any]]:
    return OBSTACLES + extra_obstacles


def _nearest_obstacle(x: float, y: float) -> float:
    obs = _all_obstacles()
    if not obs:
        return 999.0
    return min(_dist(o, x, y) for o in obs)


def _human_signal(x: float, y: float) -> tuple[bool, float, float]:
    """Returns (detected, confidence, distance_m) for the nearest human (primary + walking)."""
    # Check primary human
    d_primary = _dist(human_pos, x, y)

    # Check walking humans — find nearest overall
    d_min = d_primary
    for wh in walking_humans:
        d_wh = _dist(wh.pos, x, y)
        if d_wh < d_min:
            d_min = d_wh

    detected = d_min < 5.0  # wider detection radius for distance-based governance
    if not detected:
        return False, 0.0, d_min
    conf = max(0.4, min(0.95, 0.7 + random.uniform(-0.15, 0.15)))
    return True, conf, d_min


def _step() -> None:
    now = time.time()
    dt = now - state["last_update"]
    if dt <= 0:
        return
    state["last_update"] = now
    state["events"] = []

    # Tick walking humans
    for wh in walking_humans:
        wh.step(dt)

    # Update the primary human canonical position used elsewhere in the simulator
    try:
        human_pos["x"] = primary_human.pos["x"]
        human_pos["y"] = primary_human.pos["y"]
    except Exception:
        pass

    target = state.get("target")
    if target:
        tx, ty = float(target["x"]), float(target["y"])
        max_speed = float(target.get("max_speed", 0.5))

        dx, dy = tx - state["x"], ty - state["y"]
        dist = math.sqrt(dx * dx + dy * dy)

        if dist < 0.05:
            # Arrived
            state["speed"] = 0.0
            state["target"] = None
        else:
            # Move toward target
            step_speed = max_speed
            # Basic slowdown near obstacles to make demo interesting
            obs = _nearest_obstacle(state["x"], state["y"])
            if obs < 0.8:
                step_speed = min(step_speed, 0.35)
                state["events"].append("near_miss")

            ux, uy = dx / dist, dy / dist
            step_dist = step_speed * dt
            state["x"] += ux * min(step_dist, dist)
            state["y"] += uy * min(step_dist, dist)
            state["theta"] = math.atan2(uy, ux)
            state["speed"] = step_speed

    # Update perception
    state["zone"] = _zone_for(state["x"], state["y"])
    state["nearest_obstacle_m"] = float(_nearest_obstacle(state["x"], state["y"]))
    hd, hc, hd_m = _human_signal(state["x"], state["y"])
    state["human_detected"] = hd
    state["human_conf"] = float(hc)
    state["human_distance_m"] = float(hd_m)

    # Geofence alert (for completeness; doesn't clamp position)
    if not (
        GEOFENCE["min_x"] <= state["x"] <= GEOFENCE["max_x"]
        and GEOFENCE["min_y"] <= state["y"] <= GEOFENCE["max_y"]
    ):
        state["events"].append("geofence_violation")


@app.get("/telemetry")
def telemetry(request: Request):
    _require_sim_token(request)
    _step()
    return {
        "x": round(state["x"], 4),
        "y": round(state["y"], 4),
        "theta": round(state["theta"], 4),
        "speed": round(state["speed"], 4),
        "zone": state["zone"],
        "nearest_obstacle_m": round(state["nearest_obstacle_m"], 3),
        "human_detected": state["human_detected"],
        "human_conf": round(state["human_conf"], 3),
        "human_distance_m": round(state["human_distance_m"], 3),
        "events": state["events"],
        # Enriched fields for Fix 1
        "human": {"x": human_pos["x"], "y": human_pos["y"], "type": "unknown"},
        "walking_humans": [wh.to_dict() for wh in walking_humans],
        "idle_robots": idle_robots,
        "obstacles": _all_obstacles(),
        "bounds": GEOFENCE,
        "target": state.get("target"),
        "timestamp": time.time(),
    }


@app.get("/world")
def world(request: Request):
    _require_sim_token(request)
    return {
        "geofence": GEOFENCE,
        "zones": ZONES,
        "obstacles": _all_obstacles(),
        "human": human_pos,
        "walking_humans": [wh.to_dict() for wh in walking_humans],
        "idle_robots": idle_robots,
        "bays": BAYS,
    }


@app.post("/command")
def command(request: Request, cmd: Command):
    _require_sim_token(request)
    _step()

    if cmd.intent == "MOVE_TO":
        x = float(cmd.params.get("x", state["x"]))
        y = float(cmd.params.get("y", state["y"]))
        max_speed = float(cmd.params.get("max_speed", 0.5))
        state["target"] = {"x": x, "y": y, "max_speed": max_speed}
        return {"ok": True, "set_target": state["target"]}

    if cmd.intent == "STOP":
        state["target"] = None
        state["speed"] = 0.0
        return {"ok": True, "stopped": True}

    if cmd.intent == "WAIT":
        return {"ok": True, "wait": cmd.params.get("seconds", 1)}

    return {"ok": False, "error": f"Unknown intent: {cmd.intent}"}


# ---------------------------------------------------------------------------
# Scenario injection (Fix 2)
# ---------------------------------------------------------------------------
@app.post("/scenario")
def inject_scenario(request: Request, body: ScenarioRequest):
    """Deterministically inject a scenario for governance demo.

    Scenarios:
      - human_approach: Move human to ~2.5m from robot (triggers SLOW)
      - human_too_close: Move human to ~0.8m from robot (triggers STOP)
      - path_blocked: Insert obstacle directly ahead of robot
      - clear: Reset human & obstacles to defaults
    """
    _require_sim_token(request)
    global human_pos, extra_obstacles

    rx, ry = state["x"], state["y"]
    theta = state.get("theta", 0.0)

    if body.scenario == "human_approach":
        # Place human 2.5m ahead of robot
        human_pos["x"] = round(rx + 2.5 * math.cos(theta), 2)
        human_pos["y"] = round(ry + 2.5 * math.sin(theta), 2)
        return {"ok": True, "scenario": "human_approach", "human": dict(human_pos)}

    elif body.scenario == "human_too_close":
        # Place human 0.8m ahead of robot
        human_pos["x"] = round(rx + 0.8 * math.cos(theta), 2)
        human_pos["y"] = round(ry + 0.8 * math.sin(theta), 2)
        return {"ok": True, "scenario": "human_too_close", "human": dict(human_pos)}

    elif body.scenario == "path_blocked":
        # Insert obstacle 1.5m ahead of robot
        ox = round(rx + 1.5 * math.cos(theta), 2)
        oy = round(ry + 1.5 * math.sin(theta), 2)
        extra_obstacles.append({"x": ox, "y": oy, "r": 0.4})
        return {"ok": True, "scenario": "path_blocked", "obstacle": {"x": ox, "y": oy}}

    elif body.scenario == "clear":
        # Reset to defaults
        human_pos.update(HUMAN_DEFAULT)
        extra_obstacles.clear()
        return {"ok": True, "scenario": "clear"}

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario: {body.scenario}. "
                   f"Valid: human_approach, human_too_close, path_blocked, clear",
        )
