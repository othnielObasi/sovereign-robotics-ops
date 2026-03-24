# API Reference

Base URL: `http://localhost:8080` (local) or `https://sovereignroboticsops.nov-tia.com` (production)

Interactive docs: `{base}/docs` (Swagger UI) or `{base}/redoc` (ReDoc)

---

## Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (DB + simulator connectivity) |

---

## Missions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/missions` | Create a new mission |
| GET | `/missions` | List all missions |
| POST | `/missions/{mission_id}/start` | Start an execution run for a mission |

### Create Mission

```bash
curl -X POST http://localhost:8080/missions \
  -H "Content-Type: application/json" \
  -d '{"name": "Deliver to Bay 3", "goal": {"x": 15, "y": 7}}'
```

---

## Runs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/runs/{run_id}` | Get run status and metadata |
| POST | `/runs/{run_id}/stop` | Stop a running execution |
| POST | `/runs/{run_id}/pause` | Pause a running execution (INTERVENTION event logged) |
| POST | `/runs/{run_id}/resume` | Resume a paused execution (INTERVENTION event logged) |
| GET | `/runs/{run_id}/events` | Get all events for a run (hash-chained audit trail) |

### Pause / Resume

```bash
# Pause an active run
curl -X POST http://localhost:8080/runs/{run_id}/pause

# Resume a paused run
curl -X POST http://localhost:8080/runs/{run_id}/resume
```

---

## Governance

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/governance/evaluate` | Evaluate an action proposal against policies |
| GET | `/governance/decisions/{run_id}` | Query decision history (filterable) |
| GET | `/governance/decisions/{run_id}/stats` | Aggregate decision statistics |
| GET | `/governance/receipts/{run_id}` | List governance receipts for a run |
| GET | `/governance/receipts/{run_id}/{decision_id}` | Get a single governance receipt |

### Evaluate Action

```bash
curl -X POST http://localhost:8080/governance/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": {"x": 5, "y": 3, "zone": "aisle", "nearest_obstacle_m": 2.0,
                  "human_detected": true, "human_conf": 0.88, "human_distance_m": 1.5},
    "proposal": {"intent": "MOVE_TO", "params": {"x": 10, "y": 7, "max_speed": 0.5}}
  }'
```

### Query Decision History

```bash
# All decisions for a run
curl http://localhost:8080/governance/decisions/{run_id}

# Filter by decision type
curl "http://localhost:8080/governance/decisions/{run_id}?decision=DENIED"

# Filter by policy state
curl "http://localhost:8080/governance/decisions/{run_id}?policy_state=STOP"

# Pagination
curl "http://localhost:8080/governance/decisions/{run_id}?limit=20&offset=0"
```

### Decision Statistics

```bash
curl http://localhost:8080/governance/decisions/{run_id}/stats
# Returns: { total, approved, denied, needs_review, policy_hit_counts, avg_risk_score }
```

### Governance Receipts

Receipts are structured proof documents containing the full evaluation context.

```bash
# All receipts for a run
curl http://localhost:8080/governance/receipts/{run_id}

# Single receipt by decision ID
curl http://localhost:8080/governance/receipts/{run_id}/{decision_id}
```

---

## Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/policies` | List active policies with parameters, triggers, and actions |
| POST | `/policies/test` | Test policy evaluation with sample telemetry |

### Policy Catalog

Each policy includes:
- `id` — unique identifier (e.g. `GEOFENCE_01`)
- `name` — human-readable name
- `parameters` — threshold values used in evaluation
- `trigger` — condition that activates the policy
- `action` — resulting governance state (STOP, SLOW, REPLAN)

---

## Operator

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/operator/approve` | Approve a pending governance decision |
| POST | `/operator/override` | Override a run state (resume / force_approve / replan) |

### Operator Override

```bash
curl -X POST http://localhost:8080/operator/override \
  -H "Content-Type: application/json" \
  -d '{"run_id": "abc123", "action": "resume", "reason": "Area cleared by safety officer"}' \
  -H "X-Operator-Id: op-42"
```

Actions: `resume` (resume paused run), `force_approve` (override denial), `replan` (trigger replanning).

All overrides log an `INTERVENTION` event with type `OPERATOR_OVERRIDE:{ACTION}` in the audit trail.

---

## Compliance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/compliance/report/{run_id}` | Generate compliance report (JSON or text) |
| GET | `/compliance/verify/{run_id}` | Verify audit chain integrity |

---

## WebSocket

| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/ws/runs/{run_id}` | Real-time telemetry + governance decisions |

Message types: `telemetry`, `event`, `alert`

---

## Simulator (port 8090)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/telemetry` | Current robot state + perception |
| GET | `/world` | Full world configuration (zones, obstacles, bays) |
| POST | `/command` | Send command to robot (MOVE_TO, STOP, WAIT) |
| POST | `/scenario` | Inject a test scenario |
| GET | `/scenarios` | List all available scenarios with metadata |
| GET | `/scenarios/sequences` | List scripted scenario sequences |
| GET | `/scenarios/sequences/{id}` | Get steps for a specific sequence |

### Available Scenarios

| Scenario | Policies Exercised | Expected State |
|----------|-------------------|----------------|
| `human_approach` | HUMAN_PROXIMITY_02 | SLOW |
| `human_too_close` | HUMAN_PROXIMITY_02 | STOP |
| `path_blocked` | OBSTACLE_CLEARANCE_03 | REPLAN |
| `speed_violation` | SAFE_SPEED_01 | SLOW |
| `geofence_breach` | GEOFENCE_01 | STOP |
| `low_confidence` | UNCERTAINTY_04, HUMAN_PROXIMITY_02 | SLOW |
| `multi_worker_congestion` | WORKER_PROXIMITY_06 | STOP |
| `loading_bay_rush` | SAFE_SPEED_01, WORKER_PROXIMITY_06, OBSTACLE_CLEARANCE_03 | STOP |
| `corridor_squeeze` | OBSTACLE_CLEARANCE_03, HUMAN_PROXIMITY_02 | STOP |
| `clear` | — | SAFE |

### Scripted Sequences

| Sequence | Steps | Purpose |
|----------|-------|---------|
| `governance_demo` | 5 | Walk through core governance reactions |
| `policy_sweep` | 11 | Exercise every policy sequentially |
| `stress_test` | 7 | Rapidly trigger compound policy violations |

```bash
# List sequences
curl http://localhost:8090/scenarios/sequences

# Get steps for governance demo
curl http://localhost:8090/scenarios/sequences/governance_demo
```
