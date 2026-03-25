# Sovereign Robotics Ops

> Runtime governance for autonomous robots. Every action evaluated, every decision traceable, every violation blocked.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/next.js-14-black.svg)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-009688.svg)](https://fastapi.tiangolo.com)
[![Pydantic](https://img.shields.io/badge/Pydantic-2.x-e92063.svg)](https://docs.pydantic.dev)

---

## The Problem

Autonomous robots in warehouses, factories, and logistics have no compliance layer. When a robot makes a dangerous decision — moving too fast near a worker, breaching a geofence, operating with degraded sensors — there is no enforcement point. Logs record what happened *after* the incident. Monitoring dashboards watch; nothing *stops* the robot.

The **EU AI Act** (enforced 2026) classifies autonomous robotics as high-risk AI, mandating runtime risk management, human oversight, and tamper-evident audit trails. **ISO 42001** adoption is accelerating. Yet no existing product provides runtime governance — until now.

## What Sovereign Does

Sovereign Robotics Ops (SRO) is a **real-time governance layer** that interposes between the robot's AI planner and the physical actuators. Every proposed action is intercepted, evaluated against configurable safety policies in sub-100 ms, and either approved, modified, or blocked — *before* execution.

### Core Capabilities

| Capability | Description |
|---|---|
| **8 safety policies** | Geofence, zone speed limits, human proximity, obstacle clearance, perception uncertainty, human-in-the-loop escalation, human confidence speed check, walking worker proximity |
| **Intervention state machine** | SAFE → SLOW → STOP → REPLAN with automatic escalation and operator override |
| **Tamper-proof audit trail** | SHA-256 hash-chained event log — every decision, context, and rationale is cryptographically linked |
| **Governance receipts** | Structured proof documents for each decision, queryable per run/policy/time |
| **Regulatory compliance** | Framework-aligned reports for ISO 42001, EU AI Act, and NIST AI RMF with chain verification |
| **Operator oversight** | HITL triggers when risk ≥ 0.75; approval/deny/override workflows with full audit trail |
| **AI planner cascade** | Gemini 2.5 Pro → Gemini 2.0 Flash → deterministic fallback; never unguarded execution |
| **Circuit breaker** | 3 consecutive governance denials auto-escalate to NEEDS_REVIEW for operator attention |
| **Real-time dashboard** | Live 2D warehouse map, telemetry, policy state, and WebSocket event feed |
| **10 injectable scenarios** | Reproducible safety scenarios for testing and certification demonstrations |

## Who It's For

**Primary:** Warehouse and logistics robotics operators (AMRs, AGVs) who need to demonstrate safety compliance to insurers, regulators, or enterprise customers.

**Broader:** Any autonomous system where AI decisions must be auditable and enforceable — delivery robots, construction, agriculture, defense.

---

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/othnielObasi/sovereign-robotics-ops.git
cd sovereign-robotics-ops
docker compose up -d
```

| Service | URL |
|---------|-----|
| Frontend (Operator Dashboard) | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| API Docs (Swagger) | http://localhost:8080/docs |
| Mock Simulator | http://localhost:8090 |
| PostgreSQL | localhost:5432 |

### Local Development (without Docker)

```bash
# 1. Start the mock simulator
cd sim/mock_sim && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8090 &

# 2. Start the backend
cd backend && pip install -e ".[dev]"
export DATABASE_URL="sqlite:///./data/sro.db"
export SIM_BASE_URL="http://localhost:8090"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &

# 3. Start the frontend
cd frontend && npm install && npm run dev
```

> **Note:** Without a `GEMINI_API_KEY` set, the AI planner uses a deterministic fallback — all features work, just without LLM-generated plans.

### Optional: Gemini AI Integration

```bash
export GEMINI_API_KEY="your-key-here"
# Restart backend — planner will cascade: Gemini 2.5 Pro → 2.0 Flash → fallback
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Operator Dashboard                        │
│               Next.js 14 · React 18 · TypeScript              │
│                                                                │
│  /           /missions   /runs     /runs/:id                   │
│  Dashboard   Mission     Run       Live Run Detail             │
│  + Create    CRUD &      List      Map · Telemetry · Planner   │
│              Execute                Governance · Audit          │
│                                                                │
│  /policies   /compliance   /audit   /demo                      │
│  8 Policies  ISO/EU/NIST   Hash-    Guided                     │
│  + Test      Reports       Chain    Walkthrough                 │
│  Sandbox     + Verify      Trail                                │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼──────────────────────────────────────┐
│                   Governance API (FastAPI)                     │
│                                                                │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │  Mission   │  │   Policy      │  │   Compliance         │ │
│  │  Lifecycle │  │   Engine      │  │   Reporting          │ │
│  │            │  │               │  │                      │ │
│  │ create →   │  │ 8 policies    │  │ ISO 42001            │ │
│  │ plan →     │  │ risk scoring  │  │ EU AI Act            │ │
│  │ govern →   │  │ circuit break │  │ NIST AI RMF          │ │
│  │ execute    │  │ HITL trigger  │  │ chain verification   │ │
│  └─────┬──────┘  └──────┬────────┘  └─────────┬────────────┘ │
│        │                │                      │              │
│  ┌─────▼────────────────▼──────────────────────▼───────────┐ │
│  │           Chain-of-Trust Event Store                      │ │
│  │  SHA-256 linked events · governance decisions             │ │
│  │  telemetry samples · operator approvals                   │ │
│  │  PostgreSQL 16 (prod) · SQLite (dev) · Alembic migrations │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                     │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │              AI Planner (cascading)                       │ │
│  │  Gemini 2.5 Pro → Gemini 2.0 Flash → Deterministic      │ │
│  │  Agentic ReAct (propose → govern → replan loop)          │ │
│  └──────────────────────┬──────────────────────────────────┘ │
└──────────────────────────┼───────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼───────────────────────────────────┐
│                  Simulator / Robot Interface                   │
│  Mock warehouse sim (40×25 m) with:                           │
│  • 9 rack sections (3 rows × 3) · 20 loading/pick/staging    │
│    bays · 6 typed obstacles · 4 zones · worker detection      │
│  • 10 injectable scenarios · 3 scripted demo sequences        │
│  Pluggable: Gazebo · Isaac Sim · Physical robots              │
└──────────────────────────────────────────────────────────────┘
```

## Runtime Governance Loop

Every 100 ms while a mission is executing:

1. **Poll telemetry** — position, speed, heading, zone, human proximity, obstacle distances, sensor confidence
2. **Propose action** — AI planner generates `MOVE_TO` / `STOP` / `WAIT` with natural-language rationale
3. **Evaluate governance** — all 8 policies scored; decision = `APPROVED` / `DENIED` / `NEEDS_REVIEW`
4. **Record decision** — SHA-256 hash-chained event with full context + governance receipt
5. **Execute or block** — only `APPROVED` actions reach the simulator/robot
6. **Broadcast** — real-time WebSocket feed to operator dashboard

---

## Safety Policies

All 8 policies are defined in [`backend/app/policies/policy_catalog.yaml`](backend/app/policies/policy_catalog.yaml) with configurable parameters, and evaluated in [`backend/app/policies/rules_python.py`](backend/app/policies/rules_python.py).

| Policy | Severity | Trigger | Action |
|---|---|---|---|
| `GEOFENCE_01` | HIGH | Robot position or destination outside operating boundary | STOP |
| `SAFE_SPEED_01` | HIGH | Speed exceeds zone limit (aisle: 0.5, loading bay: 0.4, corridor: 0.7 m/s) | SLOW |
| `HUMAN_PROXIMITY_02` | HIGH | Human within proximity radius | STOP < 1 m; SLOW < 3 m |
| `HUMAN_CLEARANCE_02` | HIGH | Human detected (confidence ≥ 0.65) and speed too high | SLOW |
| `OBSTACLE_CLEARANCE_03` | HIGH | Obstacle clearance < 0.5 m | REPLAN |
| `UNCERTAINTY_04` | MEDIUM | Human detected but sensor confidence < 65% | SLOW + operator review |
| `HITL_05` | HIGH | Risk score ≥ 0.75 | NEEDS_REVIEW (operator escalation) |
| `WORKER_PROXIMITY_06` | HIGH | Walking worker within proximity radius | STOP < 1 m; SLOW < 3 m |

---

## Simulator Scenarios

The mock warehouse simulator supports 10 injectable scenarios for deterministic safety testing:

| Scenario | Effect | Policies Exercised |
|---|---|---|
| `human_approach` | Human 2.5 m from robot | HUMAN_PROXIMITY_02 → SLOW |
| `human_too_close` | Human 0.8 m from robot | HUMAN_PROXIMITY_02 → STOP |
| `path_blocked` | Obstacle 1.5 m ahead | OBSTACLE_CLEARANCE_03 → REPLAN |
| `speed_violation` | Robot at 0.8 m/s in loading bay | SAFE_SPEED_01 → SLOW |
| `geofence_breach` | Target outside boundary | GEOFENCE_01 → STOP |
| `low_confidence` | Human with low perception confidence | UNCERTAINTY_04 → SLOW |
| `multi_worker_congestion` | 3 workers near robot | WORKER_PROXIMITY_06 → STOP |
| `loading_bay_rush` | Workers + obstacle + high speed | 3 policies simultaneously |
| `corridor_squeeze` | Tight passage + worker | Multi-policy |
| `clear` | Reset to nominal state | — |

Three scripted demo sequences are available via `GET /scenarios/sequences`: `governance_demo`, `policy_sweep`, `stress_test`.

---

## API Reference

### Governance API (port 8080)

Full interactive docs at `/docs` (Swagger UI) and `/redoc`.

#### Missions

| Method | Endpoint | Description |
|---|---|---|
| POST | `/missions` | Create a mission (title + goal coordinates or bay ID) |
| GET | `/missions` | List all missions |
| GET | `/missions/{id}` | Get mission detail |
| PATCH | `/missions/{id}` | Update mission (draft/paused only) |
| POST | `/missions/{id}/start` | Start execution → creates a run |
| POST | `/missions/{id}/pause` | Pause mission |
| POST | `/missions/{id}/resume` | Resume mission |
| POST | `/missions/{id}/replay` | Replay a completed mission |
| DELETE | `/missions/{id}` | Delete mission |
| GET | `/missions/{id}/audit` | Mission audit trail |

#### Runs

| Method | Endpoint | Description |
|---|---|---|
| GET | `/runs` | List all runs |
| GET | `/runs/{id}` | Run detail + status |
| POST | `/runs/{id}/stop` | Stop a running execution |
| POST | `/runs/{id}/pause` | Pause run (INTERVENTION event logged) |
| POST | `/runs/{id}/resume` | Resume paused run |
| GET | `/runs/{id}/events` | Hash-chained event log |
| GET | `/runs/{id}/scores` | Multi-dimensional scoring (safety, compliance, efficiency, smoothness, mission success) |

#### Governance

| Method | Endpoint | Description |
|---|---|---|
| POST | `/governance/evaluate` | Evaluate a proposed action against all policies |
| GET | `/governance/decisions/{run_id}` | Decision history (filterable by decision type, policy state) |
| GET | `/governance/decisions/{run_id}/stats` | Aggregate statistics and policy hit frequencies |
| GET | `/governance/receipts/{run_id}` | Governance receipts (structured proof documents) |
| GET | `/governance/receipts/{run_id}/{id}` | Single governance receipt |

#### Compliance & Audit

| Method | Endpoint | Description |
|---|---|---|
| GET | `/compliance/report/{run_id}` | Compliance report (ISO 42001, EU AI Act, NIST AI RMF) |
| GET | `/compliance/verify/{run_id}` | Verify hash-chain integrity |
| GET | `/policies` | List all 8 active policies with parameters and triggers |
| POST | `/policies/test` | Test a proposed action in the policy sandbox |

#### Operator Oversight

| Method | Endpoint | Description |
|---|---|---|
| POST | `/operator/approve` | Approve a pending governance proposal |
| POST | `/operator/override` | Override: `resume`, `force_approve`, or `replan` |
| WS | `/ws/runs/{run_id}` | Real-time telemetry + decision WebSocket feed |

#### AI Planner (LLM)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/llm/agentic/propose` | Agentic ReAct reasoning (propose → govern → replan loop) |
| POST | `/llm/plan` | Generate multi-waypoint plan with per-waypoint governance |
| POST | `/llm/execute` | Execute a governed plan (waypoint-by-waypoint with audit trail) |
| GET | `/llm/models` | Available AI models and cascade configuration |

#### Simulator Proxy

| Method | Endpoint | Description |
|---|---|---|
| GET | `/sim/world` | Full warehouse world definition (zones, bays, obstacles, racks) |
| GET | `/sim/telemetry` | Current robot telemetry |
| GET | `/bays` | Bay directory (20 bays: dock, pick-face, staging) |
| POST | `/scenario` | Inject a test scenario |
| GET | `/scenarios` | Scenario catalog with policy metadata |
| GET | `/scenarios/sequences/{name}` | Scripted demo sequences |
| GET | `/health` | System health (DB + simulator connectivity) |

### Simulator API (port 8090)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/telemetry` | Robot state + perception data |
| GET | `/world` | World definition (geofence, zones, bays, obstacles, racks, features) |
| POST | `/command` | Send movement command (`MOVE_TO` / `STOP` / `WAIT`) |
| POST | `/reset` | Reset robot to starting position |
| POST | `/scenario` | Inject scenario directly |

---

## Warehouse Simulator

The mock simulator models a realistic **40 × 25 m warehouse** environment:

- **4 zones** — aisle (pick area), corridor (transit), staging (buffer), loading bay (dock area) — each with distinct speed limits
- **9 rack sections** — 3 rows × 3 columns of freestanding storage racks
- **20 bays** — 6 dock bays (`B-01`–`B-06`), 12 pick-face bays (`A-01`–`A-12`), 2 staging bays (`S-01`–`S-02`)
- **6 typed obstacles** — pallets, forklifts, spillage, cones, carts, bins
- **Infrastructure** — charging stations, packing stations, fire exits
- **Dynamic perception** — human detection with distance + confidence, nearest obstacle ranging, zone awareness

---

## Project Structure

```
sovereign-robotics-ops/
├── backend/                      # Governance API — Python 3.11, FastAPI
│   ├── app/
│   │   ├── api/                  # 9 route modules (missions, runs, governance,
│   │   │                         #   compliance, operator, LLM, sim, health, WS)
│   │   ├── auth/                 # JWT authentication + dev token
│   │   ├── db/                   # SQLAlchemy models + Alembic migrations
│   │   ├── observability/        # Structured logging
│   │   ├── policies/             # Policy catalog (YAML) + evaluation engine
│   │   ├── schemas/              # Pydantic v2 request/response models
│   │   ├── services/             # Governance engine, run lifecycle, compliance,
│   │   │                         #   mission service, Gemini planner, sim adapter
│   │   └── utils/                # SHA-256 hashing, ID generation, time
│   ├── alembic/                  # Database migrations (3 versions)
│   └── tests/                    # pytest suite (93+ tests)
│
├── frontend/                     # Operator Dashboard — Next.js 14, React 18, TS
│   └── src/
│       ├── app/                  # 7 page routes (/, /missions, /runs, /runs/:id,
│       │                         #   /policies, /compliance, /audit, /demo)
│       ├── components/           # Map2D (canvas), ScoreCard (radar), IntrospectionPanel
│       └── lib/                  # API client, WebSocket helpers, types
│
├── sim/mock_sim/                 # Mock warehouse simulator — FastAPI, uvicorn
│   ├── server.py                 # Simulator engine (physics, perception, scenarios)
│   └── world.json                # Warehouse definition (zones, racks, bays, obstacles)
│
├── docs/                         # 16 documentation files
├── deploy/                       # Vultr deployment script
├── infra/                        # Grafana dashboard, OTEL config, Postgres init
├── docker-compose.yml            # Local development stack
├── docker-compose.vultr.yml      # Production stack (Nginx, resource limits, healthchecks)
├── fly.toml                      # Fly.io configuration
├── Dockerfile.fly                # Combined backend + sim for Fly.io
└── .github/workflows/            # CI (pytest + build) + deploy (Fly.io, Vercel, Vultr)
```

---

## Deployment

### Docker Compose (local / self-hosted)

```bash
docker compose up -d                                    # development
docker compose -f docker-compose.vultr.yml up --build -d  # production
```

The production compose file adds:
- All ports bound to `127.0.0.1` (Nginx handles external traffic + SSL)
- Healthchecks with `depends_on: condition: service_healthy`
- Resource limits on every container
- JSON file logging with rotation
- Separate `frontend_net` / `backend_net` Docker networks

### Vultr VM

Single-VM deployment with Nginx reverse proxy and Let's Encrypt SSL. See [`deploy/vultr-deploy.sh`](deploy/vultr-deploy.sh) for the provisioning script and [`docs/VULTR_CUSTOM_DOMAIN.md`](docs/VULTR_CUSTOM_DOMAIN.md) for the Nginx configuration guide.

### Fly.io + Vercel

| Component | Platform | Guide |
|-----------|----------|-------|
| Backend + Simulator | Fly.io | [`DEPLOY_FLY.md`](DEPLOY_FLY.md) |
| Frontend | Vercel | [`DEPLOY_VERCEL.md`](DEPLOY_VERCEL.md) |

CI/CD is configured in `.github/workflows/` — push to `main` triggers backend tests, frontend build, and optional auto-deploy.

---

## Testing

```bash
# Backend tests (93+ tests — governance, API smoke, plan execution, lifecycle)
cd backend && python -m pytest tests/ -q

# Frontend type-check
cd frontend && npx tsc --noEmit
```

The test suite covers:
- Policy evaluation logic for all 8 policies
- API endpoint smoke tests (missions, runs, governance, compliance, health)
- Plan → governance → execution pipeline flow
- Run lifecycle (start, pause, resume, stop)
- Fallback and approval workflows

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | Next.js, React, TypeScript, Tailwind CSS | 14.x, 18.x, 5.x, 3.x |
| **Backend** | FastAPI, Pydantic, SQLAlchemy, Alembic | 0.111+, 2.x, 2.0+, 1.13+ |
| **AI Planner** | Google Gemini (2.5 Pro / 2.0 Flash), deterministic fallback | — |
| **Database** | PostgreSQL (prod), SQLite (dev) | 16 |
| **Simulator** | FastAPI + custom physics engine | — |
| **Auth** | JWT (python-jose), bcrypt (passlib) | — |
| **Infra** | Docker Compose, Nginx, Fly.io, Vercel, GitHub Actions | — |
| **Observability** | OpenTelemetry (config), Grafana dashboard | — |

---

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full system architecture, data models, and component diagrams |
| [docs/api.md](docs/api.md) | API reference with request/response examples |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Developer guide — local setup, CI, run lifecycle, governance engine internals |
| [docs/GEMINI_INTEGRATION.md](docs/GEMINI_INTEGRATION.md) | Gemini AI planner integration, cascade model, and governance interception flow |
| [docs/SIMULATOR_CONFIG.md](docs/SIMULATOR_CONFIG.md) | Simulator connection configuration (`SIM_BASE_URL`, `SIM_TOKEN`) |
| [docs/demo-script.md](docs/demo-script.md) | 4-minute demo script with scenario injection walkthrough |
| [docs/whitepaper.md](docs/whitepaper.md) | Technical whitepaper — architecture, policy engine, chain-of-trust, compliance |
| [docs/pitch.md](docs/pitch.md) | Product pitch summary |
| [docs/one-pager.md](docs/one-pager.md) | One-page product overview for stakeholders |
| [docs/pilot-use-cases.md](docs/pilot-use-cases.md) | Target deployment scenarios and use cases |
| [docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md) | 6-phase roadmap from prototype to production |
| [docs/JUDGE_CHECKLIST.md](docs/JUDGE_CHECKLIST.md) | Feature checklist for evaluation |
| [docs/VULTR_CUSTOM_DOMAIN.md](docs/VULTR_CUSTOM_DOMAIN.md) | Vultr + Nginx + SSL deployment guide |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | No | `sqlite:///./data/sro.db` | Database connection string |
| `SIM_BASE_URL` | No | `http://localhost:8090` | Simulator URL |
| `SIM_TOKEN` | No | `dev-token-not-for-production` | Shared auth token for simulator |
| `GEMINI_API_KEY` | No | — | Google Gemini API key (enables AI planning) |
| `JWT_SECRET` | No | auto-generated | Secret for JWT token signing |
| `AUTH_REQUIRED` | No | `false` | Enforce authentication on all endpoints |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `BACKEND_PORT` | No | `8080` | Backend listen port |

---

## License

MIT — see [LICENSE](LICENSE).
