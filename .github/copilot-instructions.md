# Copilot Instructions for Sovereign Robotics Ops

## Project Overview

**Sovereign Robotics Ops** is a **real-time governance layer** for autonomous robots. The system intercepts AI-planned actions (from Gemini Robotics-ER 1.5), evaluates them against safety policies, and approves/denies/modifies execution.

**Core Loop:**
1. Simulator/Robot produces telemetry
2. Gemini Planner proposes action (MOVE_TO, STOP, WAIT)
3. Governance Engine validates against policies
4. Chain-of-trust event created with SHA-256 hash
5. WebSocket broadcasts decision to UI
6. Robot executes (if approved)

## Architecture Essentials

### Three-Service Stack
- **Backend (FastAPI)** - `backend/app/` - Governance orchestration, policy enforcement
- **Frontend (Next.js)** - `frontend/src/` - Operator dashboard, mission control
- **Mock Simulator** - `sim/mock_sim/` - Test harness producing telemetry

### Data Flow Components

| Component | File | Purpose |
|-----------|------|---------|
| **Governance Engine** | `backend/app/services/governance_engine.py` | Evaluates proposals against policies |
| **Policy Rules** | `backend/app/policies/rules_python.py` | MVP policy definitions (speed limits, geofence, human avoidance) |
| **Gemini Planner** | `backend/app/services/gemini_planner.py` | Calls Gemini Robotics-ER 1.5 API; generates ActionProposal |
| **Run Service** | `backend/app/services/run_service.py` | Manages run lifecycle; implements main event loop (asyncio) |
| **Schemas** | `backend/app/schemas/` | Pydantic models: ActionProposal, GovernanceDecision, EventOut |
| **WebSocket Hub** | `backend/app/api/routes_ws.py` | Broadcasts decisions to connected clients in real-time |

### Key Data Models

**ActionProposal** (from Gemini):
```python
{"intent": "MOVE_TO", "params": {"x": 10, "y": 20, "max_speed": 0.5}, "rationale": "..."}
```

**GovernanceDecision**:
```python
{"decision": "APPROVED|DENIED|NEEDS_REVIEW", "policy_hits": [...], "reasons": [...], "risk_score": 0.52}
```

**Event** (chain-of-trust):
- Immutable record: telemetry → proposal → decision → hash
- Stored in PostgreSQL; linked by SHA-256 hash chain
- Table: `events` with columns: `id`, `run_id`, `type`, `payload_json`, `hash`

## Configuration & Deployment

### Environment Setup
- **Database**: PostgreSQL (Railway in production, SQLite locally)
- **Gemini**: Set `GEMINI_API_KEY` + `GEMINI_ENABLED=true` to activate; otherwise mocks
- **CORS**: `CORS_ORIGINS` (comma-separated) required for frontend
- See `backend/app/config.py` for all Settings

### Fly.io Deployment
- `fly.toml`: Defines `api` process (FastAPI) + `sim` process (mock simulator) on same machine
- `Dockerfile.fly`: Multi-stage build; Procfile runs honcho to start both
- Secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `CORS_ORIGINS`
- Health check: GET `/health` returns `gemini_enabled` status

## Common Development Tasks

### Running Locally
```bash
docker-compose up -d
# Frontend: http://localhost:3000
# Backend: http://localhost:8080/docs
# Mock Sim: http://localhost:8090
```

### Adding a New Policy
1. Add rule function in `backend/app/policies/rules_python.py`
2. Call from `evaluate_policies()` function
3. Return decision with `policy_hits`, `reasons`, `risk_score`
4. Example: Check `SAFE_SPEED_01` (zone-based speed limits)

### Testing Governance
```bash
cd backend
pytest tests/test_governance.py
```
- Test style: Import `evaluate_policies`, mock telemetry dict, assert decision
- See `test_policy_denies_speed_in_aisle()` for pattern

### Adding Frontend Pages
- Pages: `frontend/src/app/[path]/page.tsx`
- API calls: `frontend/src/lib/api.ts` (e.g., `listMissions()`, `getRun()`)
- Components: `frontend/src/components/` (Map2DEnhanced, Timeline, AlertsPanel)
- Real-time: Use `backend/app/api/routes_ws.py` endpoint `/ws/runs/{run_id}`

### Extending API Routes
- Routes: `backend/app/api/routes_*.py` (missions, runs, governance, compliance, sim)
- Dependency injection: `backend/app/deps.py` provides `SessionLocal`, auth
- Response models in `backend/app/schemas/`

## Project-Specific Conventions

### Event Types
- `TELEMETRY` - Raw sensor data snapshot
- `DECISION` - Governance decision + rationale
- `ALERT` - Human intervention / policy violation

### Risk Thresholds
- `0.00-0.70` → APPROVED
- `0.70-0.95` → NEEDS_REVIEW (if policies hit)
- `0.95+` → DENIED (geofence violation = auto-denial)

### ID Generation
- Missions: `new_id("mis")`
- Runs: `new_id("run")`
- Events: `new_id("evt")`
- From `backend/app/utils/ids.py`

### Hashing
- All events use `sha256_canonical()` from `backend/app/utils/hashing.py`
- Canonical JSON (sorted keys, no whitespace) ensures hash stability

### WebSocket Messages
```python
{"kind": "telemetry|event|alert|status", "data": {...}}
```
- Broadcast via `hub.broadcast(run_id, message)` from RunService
- Clients subscribe via `/ws/runs/{run_id}`

## Critical Patterns to Follow

### Run Lifecycle (in RunService)
1. `start_run()` - Creates DB record, spawns asyncio task
2. `_run_loop()` - Infinite loop: poll sim → get proposal → evaluate → append event → broadcast
3. `stop_run()` - Sets stop flag, marks status as "stopped"
4. Always use `SessionLocal()` per async task (SQLAlchemy thread safety)

### Gemini Integration (GeminiPlanner)
- Raises `RuntimeError` if `GEMINI_API_KEY` not set
- Extracts JSON from Gemini response using regex `(\{.*\}|\[.*\])` 
- Clamps `max_speed` to [0.1, 1.0] for safety
- Timeout default: 30s (configurable)

### Database
- Models in `backend/app/db/models.py`: Mission, Run, Event, TelemetrySample
- Relationships: Mission → Runs → Events
- Query pattern: `db.query(Model).filter(...).first()`

### Frontend Status Polling
- Health check every 30s (interval in useEffect)
- Gemini status reflects `data.gemini_enabled` from `/health`
- Component resets if API disconnects

## Testing Strategy

### Mock Simulator (`sim/mock_sim/`)
- Generates synthetic telemetry: position, obstacle distance, human detection
- Endpoint: `POST /sim/command` accepts `{"intent": "MOVE_TO", "params": {...}}`
- Useful for testing governance without real hardware

### Unit Tests
- Location: `backend/tests/`
- Run: `pytest tests/`
- Example: `test_governance.py` directly calls `evaluate_policies()`

### Integration: Dashboard Demo
- Page: `frontend/src/app/demo/page.tsx`
- Pre-configured scenarios (Safe, Human Near, Human Close, Path Blocked)
- Tests full loop: UI → API → Governance → WebSocket

## Debugging Tips

1. **Check Gemini status**: `GET /health` → `gemini_enabled: true|false`
2. **View run events**: `GET /runs/{run_id}/events` → Full chain-of-trust
3. **Verify policies**: `GET /governance/policies` (if exposed)
4. **WebSocket debug**: Browser DevTools → Network → WS, watch `/ws/runs/{run_id}` messages
5. **Logs**: 
   - Fly: `fly logs` (tail -f)
   - Local: `docker-compose logs -f backend`

## Compliance & Safety Context

- **ISO 42001** (AI Management) → Audit chain provides traceability
- **EU AI Act** → Risk-based governance (high-risk = NEEDS_REVIEW)
- **Chain-of-Trust** → SHA-256 hashes prevent tampering; immutable event log
- Every decision is cryptographically signed for regulatory proof

---

**Last Updated:** February 2026  
**Gemini Model:** gemini-robotics-er-1.5-preview  
**Primary Deployment:** Fly.io (Backend) + Railway Postgres
