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

- [ ] UI / Presentation
  - Run page shows compact agent reasoning with a "Show details" toggle.
  - Confidence displays a smoothed percentage and animated bar.
  - Waypoints highlight on hover and map shows focus ring.
  - Pipeline stage is visible on the run UI (Planning → Ready → Executing → Done).

- [ ] APIs
  - `/sim/world` returns full simulator world (geofence, obstacles, bays).
  - `/bays` returns the bays directory for quick lookup.

- [ ] Tests
  - Integration test `backend/tests/test_plan_execution.py` verifies PLAN → DECISION → EXECUTION flow.

- [ ] Known Limitations
  - LLM plans are stored in-memory; restart will lose in-flight plans unless `require_llm_plan_at_start` is set and logic for rehydration is added.
  - If Gemini API is not configured, deterministic fallback planning is used.

Notes:
- To require LLM plans at start, set `require_llm_plan_at_start=true` in backend `.env` and ensure Gemini keys are configured.
- For judge demonstrations prefer running locally with docker-compose for full integration (backend + mock-sim + frontend).
