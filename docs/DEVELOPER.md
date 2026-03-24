# Developer Guide (internal)

This document is the developer handbook for Sovereign Robotics Ops. It contains architecture details, run lifecycle,
deployment and CI instructions, and guidance for maintainers and automation.

## Project Overview

**Sovereign Robotics Ops** is a real-time governance layer for autonomous
robots. The system intercepts AI-planned actions (from Gemini Robotics-ER 1.5),
evaluates them against safety policies, and approves/denies/modifies execution.

## Architecture Essentials

- Backend: `backend/app/` (FastAPI)
- Frontend: `frontend/src/` (Next.js)
- Mock Simulator: `sim/mock_sim/`

Refer to the source files and comments for implementation details. This guide
focuses on operational knowledge and conventions useful for contributors and
automation.

### CI / Provisioning Workflows

- Workflows live in `.github/workflows/`:
  - `provision_vultr_env.yml` — writes `/etc/sro/.env` on an existing VM via SSH
  - `provision_vultr_api.yml` — creates a new Vultr instance using the Vultr API
    and a `user_data` startup script (requires `VULTR_API_KEY` in GitHub Secrets)
- Use the Actions UI to `Run workflow` when CLI dispatch returns HTTP 403.
- For safe testing, the `push` trigger validates the script content;
  `workflow_dispatch` performs real provisioning.

### Secrets and Runtime

- Runtime secrets are written to `/etc/sro/.env` on the VM (owner `root:root`,
  mode `600`).
- Do NOT commit long-lived secrets into the repo. Use GitHub Secrets for
  provisioning and rotate keys after deployment.

## Run Lifecycle

1. `start_run()` — creates DB record, spawns asyncio task
2. `_run_loop()` — poll sim → planner → evaluate_and_record → append event → broadcast
3. `pause_run()` / `resume_run()` — sets pause flag, logs INTERVENTION event
4. `stop_run()` — sets stop flag, marks status as "stopped"

States: `running` → `paused` → `running` → `completed` | `stopped`

## Governance Engine

The engine (`backend/app/services/governance_engine.py`) provides:

- `evaluate()` — stateless policy evaluation (backwards-compatible)
- `evaluate_and_record()` — evaluates, persists to `governance_decisions` table, runs circuit breaker
- Circuit breaker: 3 consecutive denials per run → auto-escalate DENIED → NEEDS_REVIEW
- Decision history + stats queries
- Governance receipts (structured proof documents)

## Policy Catalog

8 policies defined in `backend/app/policies/policy_catalog.yaml` with:
- `parameters` — threshold values (e.g. `slow_radius_m: 3.0`)
- `trigger` — human-readable activation condition
- `action` — resulting governance state (STOP, SLOW, REPLAN)

Evaluation logic: `backend/app/policies/rules_python.py`

## Database Schema

Key tables (see `backend/app/db/models.py`):
- `missions` — mission definitions with goals
- `runs` — execution runs linked to missions
- `events` — SHA-256 hash-chained audit trail (PLAN, DECISION, EXECUTION, INTERVENTION)
- `governance_decisions` — persistent record of every governance evaluation (decision, risk_score, policy_hits, etc.)
- `operator_approvals` — operator approval/rejection records

Migrations: `backend/alembic/versions/`

## Simulator Scenarios

The mock simulator (`sim/mock_sim/server.py`) supports 10 injectable scenarios:

| Scenario | Effect |
|----------|--------|
| `human_approach` | Human 2.5 m ahead → SLOW |
| `human_too_close` | Human 0.8 m ahead → STOP |
| `path_blocked` | Obstacle 1.5 m ahead → REPLAN |
| `speed_violation` | Robot at 0.8 m/s in loading bay → speed policy |
| `geofence_breach` | Target outside geofence → STOP |
| `low_confidence` | Human with low perception confidence → UNCERTAINTY |
| `multi_worker_congestion` | 3 workers near robot → STOP |
| `loading_bay_rush` | Workers + obstacle + speed in bay → multi-policy |
| `corridor_squeeze` | Tight passage + worker → multi-policy |
| `clear` | Reset to defaults |

3 scripted sequences available via `GET /scenarios/sequences`: `governance_demo`, `policy_sweep`, `stress_test`.

## Useful Commands

```bash
# Run locally
docker-compose up -d
# Frontend: http://localhost:3000
# Backend: http://localhost:8080/docs

# Run backend tests
cd backend && python -m pytest tests/ -q

# Inject a scenario
curl -X POST http://localhost:8090/scenario \
  -H "Content-Type: application/json" -d '{"scenario": "human_approach"}'

# Query governance stats for a run
curl http://localhost:8080/governance/decisions/{run_id}/stats

# Pause a run
curl -X POST http://localhost:8080/runs/{run_id}/pause
```

## Where to look

- Governance engine: `backend/app/services/governance_engine.py`
- Policies: `backend/app/policies/rules_python.py`
- Policy catalog: `backend/app/policies/policy_catalog.yaml`
- Run service: `backend/app/services/run_service.py`
- Governance API: `backend/app/api/routes_governance.py`
- Operator API: `backend/app/api/routes_operator.py`
- WebSocket hub: `backend/app/api/routes_ws.py`
- DB models: `backend/app/db/models.py`
- Schemas: `backend/app/schemas/governance.py`

---

**Last Updated:** 2026-03-24
