# Architecture

## System Overview

Sovereign Robotics Ops is a runtime governance layer for autonomous robots. It intercepts every AI-generated action, evaluates it against safety policies, and produces a cryptographic audit trail of every decision.

```
┌─────────────────────────────────────────────────────────────┐
│                     Operator Dashboard                       │
│           Next.js 14 • React 18 • TypeScript                │
│                                                              │
│  ┌──────────┐ ┌──────┐ ┌──────────┐ ┌───────┐ ┌─────────┐ │
│  │Dashboard │ │Runs  │ │Compliance│ │Audit  │ │Policies │ │
│  │+ Missions│ │Detail│ │Reports   │ │Trail  │ │Sandbox  │ │
│  └──────────┘ └──────┘ └──────────┘ └───────┘ └─────────┘ │
│                                                              │
│  Components: Map2DEnhanced • Timeline • AlertsPanel          │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST (fetch) + WebSocket (ws://)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    Governance API (FastAPI)                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  Request Layer                        │    │
│  │  routes_missions • routes_runs • routes_governance   │    │
│  │  routes_compliance • routes_operator • routes_llm    │    │
│  │  routes_ws • routes_health • auth/routes             │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                 Service Layer                        │    │
│  │                                                      │    │
│  │  RunService          GovernanceEngine                │    │
│  │  ┌────────────┐      ┌──────────────────┐           │    │
│  │  │ _run_loop  │─────▶│ evaluate()       │           │    │
│  │  │ 100ms tick │      │  ┌─────────────┐ │           │    │
│  │  │            │      │  │rules_python │ │           │    │
│  │  │ propose →  │      │  │6 policies   │ │           │    │
│  │  │ evaluate → │      │  │risk scoring │ │           │    │
│  │  │ execute or │      │  └─────────────┘ │           │    │
│  │  │ block      │      └──────────────────┘           │    │
│  │  └────────────┘                                      │    │
│  │                                                      │    │
│  │  AgentRouter         ComplianceReport                │    │
│  │  ┌────────────┐      ┌──────────────────┐           │    │
│  │  │Simple      │      │generate_report() │           │    │
│  │  │Gemini      │      │_build_audit_chain│           │    │
│  │  │Agentic     │      │_verify_chain()   │           │    │
│  │  │(ReAct+mem) │      │ISO/EU/NIST maps  │           │    │
│  │  └────────────┘      └──────────────────┘           │    │
│  │                                                      │    │
│  │  MissionService      OperatorApproval                │    │
│  │  ┌────────────┐      ┌──────────────────┐           │    │
│  │  │CRUD+audit  │      │approve/revoke    │           │    │
│  │  │goal resolve│      │proposal_hash     │           │    │
│  │  │bay snapping│      │operator auth     │           │    │
│  │  └────────────┘      └──────────────────┘           │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                  Data Layer                           │    │
│  │                                                      │    │
│  │  Mission ──< Run ──< Event (hash-chained)            │    │
│  │                  ├──< TelemetrySample                 │    │
│  │                  ├──< OperatorApproval                │    │
│  │                  └──< GovernanceDecisionRecord        │    │
│  │  Mission ──< MissionAudit                             │    │
│  │                                                      │    │
│  │  SQLAlchemy ORM • Alembic migrations                  │    │
│  │  SQLite (dev) • PostgreSQL 16 (production)            │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────────┐
│                    Simulator Layer                            │
│                                                              │
│  SimAdapter (HTTP client)                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  GET /telemetry  — position, speed, humans, obstacles │   │
│  │  GET /world      — static environment definition      │   │
│  │  POST /command   — MOVE_TO / STOP / WAIT              │   │
│  │  POST /scenario  — inject test scenarios               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Mock Simulator (FastAPI, port 8090)                         │
│  40m×25m warehouse • zones • bays • walking workers          │
│  4 patrol routes • dynamic obstacle injection                │
│                                                              │
│  Future: Gazebo • Isaac Sim • Physical robot interfaces      │
└─────────────────────────────────────────────────────────────┘
```

## Runtime Loop Detail

The core governance loop runs inside `RunService._run_loop()`:

```
┌─────────────┐
│  Poll       │ GET /telemetry from simulator
│  Telemetry  │ Store TelemetrySample
└──────┬──────┘
       ▼
┌─────────────┐
│  Diagnose   │ Calculate distance-to-goal
│  State      │ Detect stagnation (< 0.02m over 10 cycles)
└──────┬──────┘
       ▼
┌─────────────┐
│  Propose    │ If plan exists: next waypoint
│  Action     │ Otherwise: AgentRouter.propose()
└──────┬──────┘
       ▼
┌─────────────┐
│  Evaluate   │ GovernanceEngine.evaluate(telemetry, proposal)
│  Governance │ → APPROVED / DENIED / NEEDS_REVIEW
│             │ → risk_score, policy_hits, reasons, policy_state
└──────┬──────┘
       ▼
┌─────────────┐
│  Record     │ Append DECISION event (hash-chained)
│  Decision   │ Store GovernanceDecisionRecord
└──────┬──────┘
       ▼
┌─────────────┐
│  Execute    │ If APPROVED → POST /command to sim
│  or Block   │ If DENIED/NEEDS_REVIEW → no execution
│             │ Append EXECUTION event if executed
└──────┬──────┘
       ▼
┌─────────────┐
│  Broadcast  │ WebSocket → operator dashboard
│  State      │ Telemetry + decision + reasoning
└──────┬──────┘
       ▼
┌─────────────┐
│  Feedback   │ Record outcome in agent memory
│  Loop       │ Next iteration (100ms sleep)
└─────────────┘
```

## Policy Engine

The policy engine evaluates a proposal against all active policies and returns a composite decision:

```
Input: telemetry + ActionProposal(intent, params, rationale)
                    │
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
GEOFENCE_01    SAFE_SPEED_01   HUMAN_PROXIMITY_02
   ▼                ▼                ▼
OBSTACLE_03    UNCERTAINTY_04   HITL_05
   │                │                │
   └────────────────┼────────────────┘
                    ▼
         Aggregate policy_hits + risk_score
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
      APPROVED   DENIED   NEEDS_REVIEW
      (no hits)  (hard    (risk > 0.75,
                  deny)    escalate)
```

**State machine:** SAFE → SLOW → STOP → REPLAN

Each state can be triggered by any policy. STOP takes priority over SLOW; REPLAN indicates the action path is blocked and the agent should find an alternative.

## Chain of Trust

Every decision creates an immutable `Event` record:

```json
{
  "id": "evt_abc123",
  "run_id": "run_xyz",
  "ts": "2026-03-24T10:00:00Z",
  "type": "DECISION",
  "payload_json": {
    "context": { "telemetry": {...}, "mission_goal": {...} },
    "proposal": { "intent": "MOVE_TO", "params": {...} },
    "governance": { "decision": "APPROVED", "risk_score": 0.12, "policy_state": "SAFE" }
  },
  "hash": "sha256(canonical(payload + prev_hash))",
  "prev_hash": "previous_event_hash"
}
```

The `prev_hash` field creates a linked chain. Tampering with any event invalidates all subsequent hashes. Chain integrity is verifiable via `/compliance/verify/{run_id}`.

## Deployment

```
┌─────────────────────────────────────────┐
│              Vultr VM                    │
│                                         │
│  ┌──────────┐  ┌─────────────────┐     │
│  │  Nginx   │──│  Let's Encrypt  │     │
│  │  :80/443 │  │  SSL certs      │     │
│  └────┬─────┘  └─────────────────┘     │
│       │                                 │
│  ┌────▼─────────────────────────────┐  │
│  │     Docker Compose               │  │
│  │                                   │  │
│  │  ┌──────────┐  ┌──────────────┐ │  │
│  │  │ frontend │  │   backend    │ │  │
│  │  │ :3000    │  │   :8080      │ │  │
│  │  └──────────┘  └──────┬───────┘ │  │
│  │                       │         │  │
│  │  ┌──────────┐  ┌──────▼───────┐ │  │
│  │  │   sim    │  │  PostgreSQL  │ │  │
│  │  │  :8090   │  │  :5432       │ │  │
│  │  └──────────┘  └──────────────┘ │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

- Health checks on all services
- Resource limits (CPU/memory per container)
- Network isolation (frontend_net / backend_net)
- Log rotation (json-file driver)
- Auto-deploy on push to `main` via GitHub Actions

