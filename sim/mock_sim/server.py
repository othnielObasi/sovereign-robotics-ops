from __future__ import annotations

"""Mock Simulator

- Maintains a robot state in memory.
- Updates position toward a target goal when it receives MOVE_TO.
- Produces a lightweight "perception" summary:
  - nearest obstacle distance
  - whether a human is detected (nearby)
  - confidence score (simulated)
- Emits simple events like near_miss when clearance is low.

This is intentionally simple but realistic enough for a governance/ops demo.
"""

import json
import math
import os
import random
import time
from typing import Any, Dict, Optional, List

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="SRO Mock Simulator", version="0.1.0")

SIM_TICK_HZ = float(os.getenv("SIM_TICK_HZ", "10"))
DT = 1.0 / max(SIM_TICK_HZ, 1.0)

SIM_TOKEN = os.getenv("SIM_TOKEN", "").strip()

def _require_sim_token(request: Request) -> None:
    """Require X-Sim-Token header if SIM_TOKEN is configured.

    This keeps the simulator effectively "private behind the backend" for demos:
    the backend holds the token; the frontend never needs it.
    """
    if not SIM_TOKEN:
        return
    got = (request.headers.get("X-Sim-Token") or "").strip()
    if got != SIM_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized simulator call")


with open("world.json", "r", encoding="utf-8") as f:
    WORLD = json.load(f)

OBSTACLES = WORLD.get("obstacles", [])
HUMAN = WORLD.get("human", {"x": 14, "y": 7})
ZONES = WORLD.get("zones", [])
GEOFENCE = WORLD.get("geofence", {"min_x": 0, "max_x": 30, "min_y": 0, "max_y": 20})


class Command(BaseModel):
    intent: str = Field(..., description="MOVE_TO|STOP|WAIT")
    params: Dict[str, Any] = Field(default_factory=dict)


state: Dict[str, Any] = {
    "x": 2.0,
    "y": 2.0,
    "theta": 0.0,
    "speed": 0.0,
    "zone": "aisle",
    "nearest_obstacle_m": 999.0,
    "human_detected": False,
    "human_conf": 0.0,
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


def _nearest_obstacle(x: float, y: float) -> float:
    if not OBSTACLES:
        return 999.0
    return min(_dist(o, x, y) for o in OBSTACLES)


def _human_signal(x: float, y: float) -> tuple[bool, float]:
    # Human detected if within a radius; conf fluctuates a bit
    d = _dist(HUMAN, x, y)
    detected = d < 3.0
    if not detected:
        return False, 0.0
    conf = max(0.4, min(0.95, 0.7 + random.uniform(-0.15, 0.15)))
    return True, conf


def _step():
    now = time.time()
    dt = now - state["last_update"]
    if dt <= 0:
        return
    state["last_update"] = now
    state["events"] = []

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
    hd, hc = _human_signal(state["x"], state["y"])
    state["human_detected"] = hd
    state["human_conf"] = float(hc)

    # Geofence alert (for completeness; doesn't clamp position)
    if not (GEOFENCE["min_x"] <= state["x"] <= GEOFENCE["max_x"] and GEOFENCE["min_y"] <= state["y"] <= GEOFENCE["max_y"]):
        state["events"].append("geofence_violation")


@app.get("/telemetry")
def telemetry(request: Request):
    _require_sim_token(request)
    _step()
    return {
        "x": state["x"],
        "y": state["y"],
        "theta": state["theta"],
        "speed": state["speed"],
        "zone": state["zone"],
        "nearest_obstacle_m": state["nearest_obstacle_m"],
        "human_detected": state["human_detected"],
        "human_conf": state["human_conf"],
        "events": state["events"],
    }


@app.get("/world")
def world(request: Request):
    _require_sim_token(request)
    """Return the static simulated world.

    The frontend uses this to render a 2D map (geofence, obstacles, zones, human).
    """
    return {
        "geofence": GEOFENCE,
        "zones": ZONES,
        "obstacles": OBSTACLES,
        "human": HUMAN,
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
        # No-op; you could add timers if needed
        return {"ok": True, "wait": cmd.params.get("seconds", 1)}

    return {"ok": False, "error": f"Unknown intent: {cmd.intent}"}