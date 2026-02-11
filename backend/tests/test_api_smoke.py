"""API smoke tests using FastAPI TestClient."""

import json
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_root(client: TestClient):
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"


def test_health(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "gemini_enabled" in data


def test_list_missions_empty(client: TestClient):
    r = client.get("/missions")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_mission(client: TestClient):
    payload = {"title": "Test Mission", "goal": {"x": 10, "y": 5}}
    r = client.post("/missions", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "Test Mission"
    assert data["id"].startswith("mis_")
    assert data["goal"]["x"] == 10


def test_get_mission(client: TestClient):
    payload = {"title": "Get Test", "goal": {"x": 1, "y": 2}}
    created = client.post("/missions", json=payload).json()
    mid = created["id"]

    r = client.get(f"/missions/{mid}")
    assert r.status_code == 200
    assert r.json()["id"] == mid


def test_get_mission_not_found(client: TestClient):
    r = client.get("/missions/mis_nonexistent")
    assert r.status_code == 404


def test_delete_mission(client: TestClient):
    payload = {"title": "Delete Me", "goal": {"x": 0, "y": 0}}
    created = client.post("/missions", json=payload).json()
    mid = created["id"]

    r = client.delete(f"/missions/{mid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    r2 = client.get(f"/missions/{mid}")
    assert r2.status_code == 404


def test_list_policies(client: TestClient):
    r = client.get("/policies")
    assert r.status_code == 200
    policies = r.json()
    assert isinstance(policies, list)
    assert len(policies) >= 5
    ids = [p["policy_id"] for p in policies]
    assert "GEOFENCE_01" in ids
    assert "SAFE_SPEED_01" in ids


def test_policies_test_endpoint(client: TestClient):
    payload = {
        "telemetry": {"x": 5, "y": 5, "zone": "aisle", "nearest_obstacle_m": 5.0, "human_detected": False, "human_conf": 0.0},
        "proposal": {"intent": "MOVE_TO", "params": {"x": 6, "y": 6, "max_speed": 0.3}, "rationale": "test"},
    }
    r = client.post("/policies/test", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["decision"] == "APPROVED"


def test_list_runs(client: TestClient):
    r = client.get("/runs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_run_not_found(client: TestClient):
    r = client.get("/runs/run_nonexistent")
    assert r.status_code == 404


def test_compliance_frameworks(client: TestClient):
    r = client.get("/compliance/frameworks")
    assert r.status_code == 200
    data = r.json()
    ids = [f["id"] for f in data["frameworks"]]
    assert "ISO_42001" in ids
    assert "EU_AI_ACT" in ids
