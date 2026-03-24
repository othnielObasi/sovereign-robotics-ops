# Sovereign Robotics Ops

> Runtime governance for autonomous robots. Every action evaluated, every decision traceable, every violation blocked.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11-blue.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/next.js-14-black.svg)](https://nextjs.org)

## The Problem

Autonomous robots in warehouses, factories, and logistics don't have a compliance layer. When a robot makes a dangerous decision — moving too fast near a worker, ignoring a geofence, operating with degraded sensors — there's no enforcement point. Logs exist, but they record what happened *after* the incident.

## What Sovereign Does

Sovereign Robotics Ops is a **runtime governance layer** that sits between the robot's AI planner and the physical actuators. Every proposed action is intercepted, evaluated against safety policies, and either approved, modified, or blocked — before execution.

**Core guarantees:**

| Capability | What It Means |
|---|---|
| **Policy enforcement** | 6+ safety policies evaluated per action (geofence, speed limits, human proximity, obstacle clearance, uncertainty, HITL escalation) |
| **Intervention controls** | SAFE → SLOW → STOP → REPLAN state machine with operator escalation |
| **Tamper-proof audit trail** | SHA-256 hash-chained event log — every decision, every reason, every context |
| **Governance receipts** | Structured proof of why each action was allowed or blocked, queryable per run/policy/time |
| **Compliance mapping** | ISO 42001, EU AI Act, NIST AI RMF — framework-aligned reports with chain verification |
| **Operator oversight** | HITL triggers when risk exceeds threshold; approval/deny/override workflows |

## Who It's For

**Initial wedge:** Warehouse and logistics robotics operators (AMRs, AGVs) who need to demonstrate safety compliance to insurers, regulators, or enterprise customers.

**Broader market:** Any autonomous system where AI decisions must be auditable and enforceable — delivery robots, construction, agriculture, defense.

## Why Now

- **EU AI Act** (2026 enforcement) classifies autonomous robotics as high-risk AI — mandatory risk management, human oversight, and audit trails
- **ISO 42001** adoption accelerating — organizations need governance tooling, not just policies on paper
- Warehouse robotics market growing 14% CAGR — more robots, more compliance surface area
- No existing product provides runtime governance (monitoring tools watch; Sovereign *enforces*)

## Quick Start

```bash
git clone <repo>
cd sovereign-robotics-ops
docker-compose up -d

# Frontend:  http://localhost:3000
# API:       http://localhost:8080
# API Docs:  http://localhost:8080/docs
# Demo:      http://localhost:3000/demo
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Operator Dashboard                    │
│           (Next.js — missions, runs, compliance)        │
└───────────────────────┬─────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼─────────────────────────────────┐
│                   Governance API                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Mission  │  │   Policy     │  │   Compliance     │  │
│  │ Lifecycle│  │   Engine     │  │   Reporting      │  │
│  │          │  │              │  │                  │  │
│  │ create → │  │ evaluate()   │  │ ISO 42001        │  │
│  │ plan →   │  │ 6 policies   │  │ EU AI Act        │  │
│  │ execute  │  │ risk scoring │  │ NIST AI RMF      │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │               │                    │            │
│  ┌────▼───────────────▼────────────────────▼─────────┐  │
│  │        Chain-of-Trust Event Store                  │  │
│  │   SHA-256 linked events • governance decisions     │  │
│  │   telemetry samples • operator approvals           │  │
│  └────────────────────┬──────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │           Agent Router                             │  │
│  │   Simple (deterministic) │ Gemini │ Agentic ReAct  │  │
│  └────────────────────┬──────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────────┐
│              Simulator / Robot Interface                  │
│   Mock sim (warehouse) │ Gazebo │ Isaac Sim │ Physical   │
└─────────────────────────────────────────────────────────┘
```

## Runtime Loop

Every 100ms while a mission is executing:

1. **Poll telemetry** — position, speed, zone, human proximity, obstacles
2. **Propose action** — agent generates MOVE_TO/STOP/WAIT with rationale
3. **Evaluate governance** — all policies scored; decision = APPROVED/DENIED/NEEDS_REVIEW
4. **Record decision** — hash-chained event with full context + governance receipt
5. **Execute or block** — only APPROVED actions reach the simulator
6. **Broadcast** — real-time WebSocket feed to operator dashboard

## Safety Policies

| Policy | Severity | Trigger |
|---|---|---|
| `GEOFENCE_01` | HIGH | Robot or destination outside operating boundary |
| `SAFE_SPEED_01` | HIGH | Speed exceeds zone limit (aisle: 0.5, loading bay: 0.4, corridor: 0.7 m/s) |
| `HUMAN_PROXIMITY_02` | HIGH | Human within 3m → SLOW; within 1m → STOP |
| `OBSTACLE_CLEARANCE_03` | HIGH | Obstacle clearance < 0.5m |
| `UNCERTAINTY_04` | MEDIUM | Human detected but sensor confidence < 65% |
| `HITL_05` | HIGH | Risk score > 0.75 → escalate to operator |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check (DB + simulator) |
| POST | `/missions` | Create mission |
| POST | `/missions/{id}/start` | Start execution run |
| POST | `/runs/{id}/stop` | Stop run |
| POST | `/runs/{id}/pause` | Pause run (INTERVENTION logged) |
| POST | `/runs/{id}/resume` | Resume paused run |
| POST | `/governance/evaluate` | Evaluate action against policies |
| GET | `/governance/decisions/{run_id}` | Query decision history (filterable) |
| GET | `/governance/decisions/{run_id}/stats` | Decision statistics & policy hit counts |
| GET | `/governance/receipts/{run_id}` | Governance receipts (structured proofs) |
| GET | `/governance/receipts/{run_id}/{id}` | Single governance receipt |
| GET | `/policies` | List active policies with parameters |
| POST | `/policies/test` | Test policy evaluation |
| GET | `/compliance/report/{run_id}` | Generate compliance report (JSON/text) |
| GET | `/compliance/verify/{run_id}` | Verify audit chain integrity |
| POST | `/operator/approve` | Operator approves proposal |
| POST | `/operator/override` | Operator override (resume/force_approve/replan) |
| WS | `/ws/runs/{run_id}` | Real-time telemetry + decisions |

### Simulator API (port 8090)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/telemetry` | Robot state + perception |
| POST | `/scenario` | Inject test scenario (10 available) |
| GET | `/scenarios` | Scenario catalog with policy metadata |
| GET | `/scenarios/sequences` | Scripted demo sequences |

## Deployment (Vultr)

Production deploys to a single Vultr VM. Pushing to `main` auto-deploys via GitHub Actions.

```bash
# Manual deploy on VM
docker compose -f docker-compose.vultr.yml up --build -d
```

See [docs/DEVELOPER.md](docs/DEVELOPER.md) for local development and [deploy/vultr-deploy.sh](deploy/vultr-deploy.sh) for full provisioning.

## Project Structure

```
sovereign-robotics-ops/
├── backend/                 # FastAPI governance API (Python 3.11)
│   ├── app/
│   │   ├── api/            # REST endpoints
│   │   ├── auth/           # JWT authentication
│   │   ├── db/             # SQLAlchemy models + migrations
│   │   ├── policies/       # Safety policy definitions
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── services/       # Governance engine, run lifecycle, compliance
│   │   └── utils/          # Hashing, IDs, time
│   ├── alembic/            # Database migrations
│   └── tests/              # Backend test suite
├── frontend/               # Next.js 14 operator dashboard
│   └── src/
│       ├── app/            # Pages (dashboard, demo, runs, compliance, audit, policies)
│       └── components/     # Map2D, Timeline, Alerts
├── sim/                    # Mock warehouse simulator
├── deploy/                 # Deployment scripts
├── docs/                   # Architecture, API, guides
└── .github/workflows/      # CI + auto-deploy to Vultr
```

## Documentation

| Document | Purpose |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System architecture and data flow |
| [docs/api.md](docs/api.md) | API reference |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Local dev setup, CI, provisioning |
| [docs/one-pager.md](docs/one-pager.md) | Product overview for stakeholders |
| [docs/pilot-use-cases.md](docs/pilot-use-cases.md) | Target deployment scenarios |
| [docs/whitepaper.md](docs/whitepaper.md) | Technical whitepaper |

## License

MIT — see [LICENSE](LICENSE).
