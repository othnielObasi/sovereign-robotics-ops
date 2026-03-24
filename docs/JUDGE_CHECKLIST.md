Judge Checklist — Sovereign Robotics Ops

- [ ] Deployment
  - Frontend and backend reachable; API docs accessible at `/docs`.
  - Nginx config writable (deploy script may require root to edit `/etc/nginx`).

- [ ] Mission Planning
  - Every mission start produces a PLAN event (configurable via `require_llm_plan_at_start`).
  - Plans are multi-waypoint and include `max_speed` per waypoint.

- [ ] Governance
  - Decisions recorded as `DECISION` events with `governance` payload and `risk_score`.
  - Execution attempts recorded as `EXECUTION` events and included in the chain-of-trust.
  - Circuit breaker: 3 consecutive denials auto-escalate to NEEDS_REVIEW.
  - `GET /governance/decisions/{run_id}` returns full decision history (filterable by decision/policy_state).
  - `GET /governance/decisions/{run_id}/stats` returns aggregate counts and policy hit frequencies.
  - `GET /governance/receipts/{run_id}` returns structured proof documents for each decision.

- [ ] Run Lifecycle & Intervention
  - `POST /runs/{run_id}/pause` pauses an active run and logs an INTERVENTION event.
  - `POST /runs/{run_id}/resume` resumes a paused run and logs an INTERVENTION event.
  - `POST /operator/override` accepts actions: `resume`, `force_approve`, `replan`.
  - All overrides create `OPERATOR_OVERRIDE:{ACTION}` events in the audit trail.

- [ ] Simulator Scenarios
  - `POST /scenario` with `{"scenario": "human_approach"}` → governance SLOW state.
  - `POST /scenario` with `{"scenario": "human_too_close"}` → governance STOP state.
  - `POST /scenario` with `{"scenario": "speed_violation"}` → SAFE_SPEED_01 fires.
  - `POST /scenario` with `{"scenario": "geofence_breach"}` → GEOFENCE_01 fires.
  - `POST /scenario` with `{"scenario": "loading_bay_rush"}` → 3 policies fire simultaneously.
  - `GET /scenarios` returns full scenario catalog with policies_exercised and expected_state.
  - `GET /scenarios/sequences/governance_demo` returns a 5-step scripted demo sequence.

- [ ] UI / Presentation
  - Run page shows compact agent reasoning with a "Show details" toggle.
  - Confidence displays a smoothed percentage and animated bar.
  - Waypoints highlight on hover and map shows focus ring.
  - Pipeline stage is visible on the run UI (Planning → Ready → Executing → Done).

- [ ] APIs
  - `/sim/world` returns full simulator world (geofence, obstacles, bays).
  - `/bays` returns the bays directory for quick lookup.
  - `/policies` returns all 8 policies with parameters, triggers, and actions.
  - `/compliance/verify/{run_id}` validates hash-chain integrity.

- [ ] Tests
  - Integration test `backend/tests/test_plan_execution.py` verifies PLAN → DECISION → EXECUTION flow.
  - `backend/tests/test_governance.py` verifies policy evaluation logic.
  - All 28 tests pass: `cd backend && python -m pytest tests/ -q`

- [ ] Known Limitations
  - LLM plans are stored in-memory; restart will lose in-flight plans unless `require_llm_plan_at_start` is set.
  - Pause/resume state is in-memory; restarting the backend will lose pause flags for active runs.
  - If Gemini API is not configured, deterministic fallback planning is used.
  - Circuit breaker counter resets on backend restart.

Notes:
- To require LLM plans at start, set `require_llm_plan_at_start=true` in backend `.env` and ensure Gemini keys are configured.
- For judge demonstrations prefer running locally with docker-compose for full integration (backend + mock-sim + frontend).
- Use `GET /scenarios/sequences/governance_demo` to get the recommended 5-step demo sequence.
