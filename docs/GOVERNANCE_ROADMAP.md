# Governance-Bounded Production Roadmap

> Gap analysis and implementation plan for evolving SRO from hackathon prototype
> to a governance-bounded optimization platform inside a hard safety envelope.
>
> **Principle**: Do not treat this as reward-led autonomy.
> Treat it as governance-bounded optimization inside a hard safety envelope.

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented and working |
| ⚠️ | Partially implemented — gaps identified |
| ❌ | Not implemented — new work required |

---

## Summary Scorecard

| # | Item | Priority | Status | Coverage |
|---|------|----------|--------|----------|
| 1 | LLM → Governance → Execution pipeline | Highest | ✅ | ~90% |
| 2 | Agentic planner controls execution | Highest | ✅ (opt-in) | ~75% |
| 3 | Fix LLM path vs executed path divergence | Highest | ⚠️ | ~50% |
| 4 | Simulator as single source of truth | Highest | ✅ | ~95% |
| 5 | Formalise governance constraints | Highest | ✅ | ~85% |
| 6 | Waypoint/controller fidelity | Highest | ⚠️ | ~40% |
| 7 | Governance-bounded optimization framework | Very High | ❌ | 0% |
| 8 | Multi-objective scoring engine | Very High | ❌ | 0% |
| 9 | Run metrics logging | Very High | ⚠️ | ~35% |
| 10 | Scoring UI | Very High | ❌ | 0% |
| 11 | Keep learning above control | Very High | ✅ | ~80% |
| 12 | Adaptive tuning / safe learning | Very High | ❌ | ~10% |
| 13 | Safe parameter auto-tuning | Very High | ❌ | 0% |
| 14 | Policy thresholds / hard-failure gates | High | ⚠️ | ~40% |
| 15 | Anti-reward-hacking protections | High | ❌ | 0% |
| 16 | Policy versioning and tuning history | High | ❌ | 0% |
| 17 | Memory-based strategy preference | High | ⚠️ | ~30% |
| 18 | Internalised learning | High | ❌ | 0% |
| 19 | Agentic planner with tool use | High | ✅ | ~85% |
| 20 | Agent introspection | High | ⚠️ | ~40% |
| 21 | Risk heatmaps and safety overlays | Medium | ⚠️ | ~25% |
| 22 | Consolidate UI | Medium | ⚠️ | ~60% |
| 23 | Tighten warehouse semantic model | Medium | ✅ | ~80% |
| 24 | World model alignment | Medium | ⚠️ | ~70% |
| 25 | Mission semantics in UI | Medium | ⚠️ | ~40% |
| 26 | Post-hackathon release | Later | ❌ | — |
| 27 | Evolve to real platform | Later | ⚠️ | — |
| 28 | Full RL (later-stage only) | Later | ❌ | — |

---

## Highest Priority (1–6)

### 1. True LLM → Governance → Execution Pipeline

**Status: ✅ Implemented (~90%)**

The backbone pipeline works end-to-end:

| Stage | Implementation | File |
|-------|---------------|------|
| LLM plan | `GeminiPlanner.generate_plan()` — Gemini API with 6-model cascade | `backend/app/services/gemini_planner.py` |
| Safety review | Per-waypoint governance validation in `/llm/plan` endpoint | `backend/app/api/routes_llm.py` L122–137 |
| Policy validation | `evaluate_and_record()` called every tick of the run loop | `backend/app/services/governance_engine.py` L42 |
| Execution with trace | Approved actions sent to simulator; EXECUTION event logged | `backend/app/services/run_service.py` L356–371 |
| Logging | Chain-of-trust hashing via `sha256_canonical`, every event with `prev_hash` | `backend/app/services/run_service.py` |

**Execution flow** (`_run_loop` in `run_service.py` L226–460):

```
telemetry → proposal (from plan or agent) → speed clamp → governance gate → execute if approved → log event → broadcast to UI
```

**Remaining gap**:
- The `start_run` flow generates the LLM plan in the background and attaches it while the
  run is already executing with a fallback waypoint. There is no upfront "plan approval gate"
  that validates the entire plan before execution begins.

---

### 2. Agentic Planner Controls Execution

**Status: ✅ Implemented, opt-in (~75%)**

Two planning modes exist, selected by `AgentRouter` in `agent_service.py`:

| Mode | Config | Behaviour |
|------|--------|-----------|
| `gemini` (default) | `llm_provider="gemini"` | Single-call `GeminiPlanner.propose()` — stateless |
| `agentic` | `llm_provider="agentic"` | ReAct agent with tool use, memory, replanning on denial |

When a plan exists (`_plans[run_id]`), waypoints are consumed sequentially
(`run_service.py` L332–341). When no plan exists, `agent.propose()` is called (L343).

The agentic planner (`agentic_planner.py`) provides:
- 3 tools: `get_world_state`, `check_policy`, `submit_action`
- `AgentMemory` — sliding window of 20 past decisions
- Up to 2 replans on denial with denial feedback injected into prompt
- Graceful fallback to `WAIT` with manual override recommendation

**Remaining gaps**:
- `llm_enabled` defaults to `False`; agentic mode is not the default.
- Clicking "Start Run" in the UI uses the background LLM plan path, not the agentic pipeline.
- No UI toggle to switch planning mode per-mission.

---

### 3. Fix LLM Path vs Executed Path Divergence

**Status: ⚠️ Partial (~50%)**

**What works**:
- Plan waypoints consumed in order; denied waypoints retry on next tick (not popped).
- Speed clamped to zone limits before governance check (`run_service.py` L348–352).

**What diverges**:
- Clamped speed can differ from what the LLM planned (LLM might plan 0.8 m/s, zone
  limit clamps to 0.5 m/s — the plan shows one thing, execution does another).
- If a human appears in the path of a planned waypoint, the robot retries the same blocked
  waypoint indefinitely instead of replanning.
- **No replan-on-repeated-denial in the main loop.** The circuit breaker escalates to
  `NEEDS_REVIEW` after 3 denials but does not trigger a replan. Only the agentic planner's
  internal ReAct cycle replans, and only when `llm_provider="agentic"`.
- The UI shows the originally planned path, not the actually executed path (which may skip
  or retry waypoints).

**Required work**:
- Add replan trigger when consecutive denials exceed threshold in the main run loop.
- Track and broadcast the executed path (list of positions the robot actually visited)
  alongside the planned path for UI comparison.
- Adjust plan display after speed clamping so the visible plan matches execution.

---

### 4. Simulator as Single Source of Truth

**Status: ✅ Implemented (~95%)**

The simulator (`sim/mock_sim/server.py`) owns all authoritative state:

| State | Source |
|-------|--------|
| Robot pose (x, y, theta) | `state["x"]`, `state["y"]`, `state["theta"]` in sim |
| Robot speed | `state["speed"]` — computed during `_step()` |
| Active target | `state["target"]` — set via `POST /command` |
| Zone classification | Computed from position in `_step()` |
| Obstacle/human perception | Computed from world model in `_step()` |

The backend reads telemetry from the sim every tick and never maintains its own copy
of robot position. `self._last_positions[run_id]` in `run_service.py` is diagnostic
only (stagnation detection), not authoritative.

**No significant gaps.**

---

### 5. Formalise Governance Constraints

**Status: ✅ Implemented (~85%)**

8 policies defined in `policy_catalog.yaml`, enforced in `rules_python.py`:

| Policy ID | Constraint | Action |
|-----------|-----------|--------|
| `GEOFENCE_01` | Robot and destination within 0–40 × 0–25 bounds | STOP |
| `SAFE_SPEED_01` | Zone speed limits: aisle 0.5, corridor 0.7, loading_bay 0.4 m/s | SLOW |
| `HUMAN_PROXIMITY_02` | STOP <1m, SLOW <3m from human/worker | STOP / SLOW |
| `HUMAN_CLEARANCE_02` | Speed cap when human detected (conf ≥ 0.65) | SLOW |
| `OBSTACLE_CLEARANCE_03` | Min 0.5m obstacle clearance | REPLAN |
| `UNCERTAINTY_04` | Low perception confidence → reduce speed | SLOW |
| `HITL_05` | Risk ≥ 0.75 → operator escalation | NEEDS_REVIEW |
| `WORKER_PROXIMITY_06` | Walking worker proximity zones (same radii as human) | STOP / SLOW |

Additional mechanisms:
- **Circuit breaker** — 3 consecutive denials → escalation (`governance_engine.py` L47–70)
- **Operator approval/override** — `routes_operator.py` endpoints
- **Per-tick governance gate** — every loop iteration is gated

**Remaining gaps**:
- Risk scoring is a simple `max()` heuristic (0–1), not a weighted composite.
- No explicit "forbidden motion states" (e.g., reversing, spinning in place).
- No pre-run approval gate (only per-tick during execution).

---

### 6. Waypoint/Controller Fidelity

**Status: ⚠️ Basic (~40%)**

The simulator uses linear interpolation toward the target waypoint:

```python
ux, uy = dx / dist, dy / dist
state["x"] += ux * min(step_speed * dt, dist)
state["y"] += uy * min(step_speed * dt, dist)
state["theta"] = math.atan2(uy, ux)
```

- ✅ Smooth continuous movement (not teleportation)
- ✅ Obstacle proximity slowdown (< 0.8m → cap at 0.35 m/s)
- ✅ Heading updates via `atan2`
- ✅ Arrival detection within 0.05m

**Remaining gaps**:
- No acceleration/deceleration curves — speed changes are instantaneous.
- No path smoothing — robot beelines toward each waypoint in straight segments.
- No curvature or turning radius constraints.
- No PID controller or kinematic model — just proportional control.
- Adequate for demo, but not operationally credible for kinematic realism.

**Required work**:
- Add trapezoidal velocity profile (ramp up, cruise, ramp down).
- Implement heading rate limit for realistic turning.
- Consider Bezier or Dubins path interpolation between waypoints.

---

## Very High Priority (7–13)

### 7. Governance-Bounded Optimization Framework

**Status: ❌ Not Implemented (0%)**

The system enforces governance as a hard gate (deny/approve) but performs no
optimisation within the safe action space. The LLM proposes one plan; governance
accepts or rejects it. There is no mechanism to:

- Generate multiple candidate actions.
- Score only policy-compliant candidates.
- Select the best-scoring compliant action.
- Keep hard safety outside the reward logic.

**Required work**:
- Design an action-space sampler that generates N candidate proposals.
- Filter candidates through `evaluate_policies()` to keep only compliant ones.
- Score compliant candidates using the multi-objective engine (item 8).
- Select the highest-scoring safe action for execution.

---

### 8. Multi-Objective Scoring Engine

**Status: ❌ Not Implemented (0%)**

No scoring engine exists. The only numeric output is `risk_score` (a 0–1 heuristic
in `evaluate_policies()`).

**Required dimensions**:

| Score | Measures |
|-------|----------|
| Safety score | Inverse of risk; min human distance; policy hit count |
| Mission success score | Distance to goal; waypoints completed; mission completed |
| Compliance score | Governance approval rate; escalation count |
| Efficiency score | Path length vs optimal; time to completion |
| Smoothness score | Speed variance; heading change rate; stop count |

**Required work**:
- Create `backend/app/services/scoring_engine.py` with a `ScoreCard` model.
- Compute per-tick component scores and aggregate at run completion.
- Store final `ScoreCard` on the Run record or in a new `run_scores` table.
- Expose via `GET /runs/{run_id}/scores` endpoint.

---

### 9. Run Metrics Logging

**Status: ⚠️ Partial (~35%)**

**What exists**:
- ✅ Events (DECISION, EXECUTION, TELEMETRY, PLAN, STAGNATION, INTERVENTION)
- ✅ Telemetry samples via `TelemetryService.add_sample()`
- ✅ Governance decisions with risk_score, policy_hits via `GovernanceDecisionRecord`
- ✅ Governance stats (approval rate, avg risk, policy hit counts) via `get_decision_stats()`

**What is missing**:

| Metric | Status |
|--------|--------|
| Planning mode (gemini / agentic / fallback) | ❌ Not logged |
| STOP/SLOW event counts per run | ❌ Not aggregated |
| Minimum human distance during run | ❌ Not tracked |
| Total path length | ❌ Not computed |
| Run duration | ⚠️ Can be derived from `started_at`/`ended_at` |
| Violation count | ❌ Not aggregated |
| Score components | ❌ Scoring engine does not exist |
| Total weighted score | ❌ Scoring engine does not exist |
| Policy version | ❌ Policies are not versioned |
| Planner version | ❌ Not tagged |
| Tuning version | ❌ Tuning does not exist |

**Required work**:
- Add a `RunMetrics` model or extend `Run` with aggregated fields.
- Compute metrics on run completion in `_run_loop` cleanup.
- Log planning mode at run start.

---

### 10. Scoring UI

**Status: ❌ Not Implemented (0%)**

The UI currently shows:
- Governance decision (APPROVED/DENIED/NEEDS_REVIEW)
- Risk score (single float)
- Policy state (SAFE/SLOW/STOP/REPLAN)
- Policy hits (list of IDs)

**What is missing**:
- Total weighted score display
- Score breakdown (safety, efficiency, compliance, mission success, smoothness)
- Score trend charts across runs
- Run comparison view

**Depends on**: Item 8 (scoring engine) and item 9 (metrics logging).

---

### 11. Keep Learning Above Control, Not Inside Safety

**Status: ✅ Correct by Design (~80%)**

Hard safety policies in `rules_python.py` are immutable constants. The agentic
planner's `AgentMemory` only influences proposal strategy — it cannot modify policy
thresholds, geofence bounds, or speed limits. Learning (agent memory) sits above
the governance gate.

**Remaining gap**:
- This separation is by convention, not by architecture. Nothing prevents a future
  developer from modifying `rules_python.py` constants at runtime.
- No formal interface contract between "immutable safety layer" and "tunable parameters."

**Required work**:
- Extract immutable safety parameters into a frozen config that cannot be modified
  at runtime (e.g., frozen dataclass, read-only property).
- Define an explicit `TunableParams` layer for parameters that learning can adjust.
- Add runtime assertion that safety thresholds haven't been tampered with.

---

### 12. Adaptive Tuning / Safe Learning

**Status: ❌ Mostly Missing (~10%)**

`AgentMemory` in `agentic_planner.py` stores recent decision history (20 entries)
and biases future proposals (e.g., if denied for speed, proposes lower speed next
time). But:

- ❌ Memory is ephemeral — lost on restart.
- ❌ No parameter tuning — operational parameters never change.
- ❌ No bounded adaptation framework.
- ❌ No audit trail of what was tuned and why.

**Required work**:
- Persist agent memory to database (new `agent_memory` table).
- Define tunable parameter ranges (e.g., preferred speed: 0.3–0.5 in aisles).
- Implement bounded adjustment: if last N runs had 0 violations at speed 0.4,
  allow gradual increase to 0.45 (within approved range).
- Log every parameter change with justification.

---

### 13. Safe Parameter Auto-Tuning

**Status: ❌ Not Implemented (0%)**

No mechanism to adjust operational parameters based on historical run performance.

**Required work**:
- Track score trends per parameter configuration.
- Implement conservative adjustment rules:
  - Increase caution (lower speed, wider margins) when violations occur.
  - Relax cautiously when repeated runs are violation-free.
  - Never exceed approved operating ranges.
- Add approval gate for parameter changes above threshold magnitude.
- Log tuning decisions in governance audit trail.

---

## High Priority (14–20)

### 14. Policy Thresholds and Hard-Failure Gates

**Status: ⚠️ Partial (~40%)**

Governance denies unsafe actions in real-time. But there is no post-run validation
that rejects an entire run as invalid.

**What exists**:
- ✅ Per-tick governance gate (deny/approve)
- ✅ Circuit breaker (3 denials → escalation)
- ✅ Operator escalation on high risk

**What is missing**:
- ❌ Minimum safety threshold for a run to be considered valid.
- ❌ Minimum compliance threshold.
- ❌ Automatic invalidation of runs with critical safety events.
- ❌ Hard failure on forbidden events (geofence breach while moving, unsafe motion).

A run with 50 near-misses and 1 geofence breach still shows as "completed" if
it reached the goal.

**Required work**:
- Add run-level validation on completion that checks aggregate safety metrics.
- Mark runs as `failed_safety` if critical thresholds are breached.
- Expose run validity status in UI and API.

---

### 15. Anti-Reward-Hacking Protections

**Status: ❌ Not Implemented (0%)**

No scoring exists yet, so no hacking to protect against. When scoring is added
(item 8), the following protections will be needed:

- Anomaly detection on unexpectedly high scores.
- Scenario diversity testing (ensure scores hold across varied conditions).
- Holdout scenarios not seen during tuning.
- Adversarial evaluation (deliberately adversarial scenario injection).
- Review pipeline for suspicious improvements.

**Depends on**: Item 8 (scoring engine).

---

### 16. Policy Versioning and Tuning History

**Status: ❌ Not Implemented (0%)**

Policy parameters are hardcoded constants in `rules_python.py` (L8–26). There is
no version tracking, no changelog, and no linkage between runs and the policy
version that was used.

**Required work**:
- Add `policy_version` field to `Run` and `GovernanceDecisionRecord`.
- Compute policy version hash from current parameter values.
- Store policy snapshots in a `policy_versions` table.
- Show policy version in run detail UI.
- Track tuning lineage (which parameter changes led to which score changes).

---

### 17. Memory-Based Strategy Preference

**Status: ⚠️ Partial (~30%)**

**What exists**:
- `AgentMemory` in `agentic_planner.py` stores (situation, strategy, outcome)
  tuples and injects the last 8 entries into the LLM prompt as context.
- Denial count tracking biases agent toward safer proposals.

**What is missing**:
- ❌ Memory is ephemeral (in-memory, lost on restart).
- ❌ Limited to 20 entries per session.
- ❌ Only active in agentic mode (`llm_provider="agentic"`).
- ❌ No similarity retrieval (just chronological last-N).
- ❌ No scoring of remembered strategies.

**Required work**:
- Persist memory entries to database.
- Add similarity-based retrieval (match current situation to similar past situations).
- Score stored strategies by outcome quality.
- Bias future planning toward strategies with better scores.

---

### 18. Internalised Learning

**Status: ❌ Not Implemented (0%)**

No persistent learning across runs. No mechanism to avoid repeating poor plans
beyond the ephemeral memory window.

**Depends on**: Items 8 (scoring), 12 (adaptive tuning), 16 (policy versioning),
17 (memory-based strategy).

**Required work**:
- Aggregate cross-run learning from memory + scoring data.
- Build strategy preference model (which approaches work in which situations).
- Ensure all learning remains safety-bounded (item 11).
- Add learning audit trail.

---

### 19. Agentic Planner with Tool Use

**Status: ✅ Implemented (~85%)**

`AgenticPlanner` in `agentic_planner.py` provides:

| Feature | Status |
|---------|--------|
| `check_policy` tool (pre-check governance) | ✅ |
| `get_world_state` tool (environment awareness) | ✅ |
| `submit_action` tool (final proposal) | ✅ |
| Memory-informed replanning (up to 2 replans) | ✅ |
| Full chain-of-thought capture for audit | ✅ |
| Graceful fallback to WAIT on failure | ✅ |

**Remaining gaps**:
- No `replan_subpath` tool (plan a partial detour around an obstacle).
- No `query_memory` tool (explicitly ask memory for similar past situations).
- No tool for decomposing complex multi-step tasks into sub-goals.

---

### 20. Agent Introspection

**Status: ⚠️ Partial (~40%)**

**What exists**:
- UI displays agent reasoning chain (thought → action → observation steps).
- `/llm/failure-analysis` endpoint detects stuck robots and oscillation.
- `/llm/analyze` endpoint examines mission event logs for anomalies.

**What is missing**:
- ❌ No "reflect on past errors" capability (compare outcome vs expectation).
- ❌ No "justify divergence" (explain why actual path differed from plan).
- ❌ No post-run summary of mistakes and lessons learned.
- ❌ No retry-with-new-plan triggered by introspection.

**Required work**:
- Add post-run reflection endpoint that compares planned vs actual path.
- Generate natural-language explanation of divergences.
- Feed reflection output back into agent memory for future runs.

---

## Medium Priority (21–25)

### 21. Risk Heatmaps and Safety Overlays

**Status: ⚠️ Partial (~25%)**

`Map2DEnhanced` component renders zones as colored rectangles, bays as markers,
obstacles as red squares, and humans as amber circles. But there are no dynamic
risk visualisations.

**What is missing**:
- ❌ Real-time risk heatmap (grid-based risk intensity).
- ❌ Safety zone gradients (proximity-based color fading).
- ❌ Path risk overlay (colour the planned path by risk level at each waypoint).
- ❌ Historical risk accumulation view.

---

### 22. Consolidate the UI

**Status: ⚠️ Partial (~60%)**

The run detail page already shows:
- ✅ Governance decision + risk score + policy hits
- ✅ Telemetry (position, speed, obstacles, humans)
- ✅ AI Mission Planner Studio (reasoning → planning → governing → executing)
- ✅ Chain-of-trust timeline with event hashes
- ✅ AI Intelligence Console (scene analysis, telemetry analysis, failure detection)
- ❌ No scoring breakdown (scoring engine does not exist yet)
- ❌ No policy version display
- ❌ Planner mode not displayed prominently
- ❌ No run comparison view

---

### 23. Tighten Warehouse Semantic Model

**Status: ✅ Good (~80%)**

`world.json` defines a consistent model:
- Geofence: 0–40 × 0–25
- 3 zones: aisle (y < 12), corridor (12–18), loading_bay (y > 18)
- 10 bays with coordinates, types, and access directions
- 5 obstacles with radii
- Human starting position, walking humans

Used consistently by simulator, backend policy engine, and frontend map.

**Minor gap**: Bay naming convention could be formalised (B- for bays, S- for
shelves, R- for racks) with machine-readable schema validation.

---

### 24. Align Planning, Governance, and Rendering to Same World Model

**Status: ⚠️ Mostly Aligned (~70%)**

The simulator serves `GET /world` which is consumed by backend and frontend. But:

- **Policy constants are duplicated**: `GEOFENCE`, `ZONE_SPEED_LIMITS` are hardcoded
  in `rules_python.py` (L8–15). If `world.json` changes, the policy engine won't
  pick up the new bounds.
- The `GeminiPlanner` hardcodes geofence clamp to `0–40 × 0–25` in
  `gemini_planner.py` (L228) rather than reading from the world model.

**Required work**:
- Make the policy engine read geofence and zone definitions from the world model
  (fetched once at startup or from a cached endpoint).
- Remove hardcoded bounds from `rules_python.py` and `gemini_planner.py`.
- Add a single `WorldModel` service that all components consume.

---

### 25. Mission Semantics in UI

**Status: ⚠️ Partial (~40%)**

- ✅ Mission title and goal coordinates are displayed.
- ✅ Bay auto-resolution exists (frontend resolves bay IDs from title text).
- ❌ No explicit "Destination: Bay B-03" label in the UI.
- ❌ No bay highlighting on the map (destination bay not visually distinguished).
- ❌ No semantic approval explanation ("This mission requires traversing a human
  zone — operator approval recommended").

---

## Lower Priority / Later-Stage (26–28)

### 26. Post-Hackathon Release

Not started. Best done after the measurement layer (items 7–10) and governance
maturity (items 14–16) are in place.

### 27. Evolve to Real Platform

This is the overarching objective, not a single implementation task. Progress is
tracked by the items above. Key pillars:
- Determinism (items 4, 5, 6)
- Auditability (items 9, 16, 20)
- Safety-by-design (items 11, 14)
- Measurable improvement (items 8, 12, 13)
- Governance-bounded optimization (item 7)

### 28. Full RL (Later-Stage Only)

Not started. Correctly deferred. Prerequisites before considering:
- Stable multi-objective scoring (item 8)
- Sufficient simulation data and run history
- Strong safety envelopes (items 5, 11, 14)
- Offline-only; never online RL in safety-critical loop

---

## Best Practical Sequence

Based on the gap analysis, the cleanest implementation order is:

### Phase A — Close Execution Gaps (items 3, 6)
1. Add replan-on-repeated-denial in the main run loop.
2. Track and broadcast executed path alongside planned path.
3. Add trapezoidal velocity profile to simulator movement.
4. Add heading rate limit for realistic turning.

### Phase B — Measurement Layer (items 8, 9, 10)
5. Build multi-objective scoring engine (`ScoreCard` model).
6. Add run metrics aggregation on completion.
7. Expose scores via API endpoint.
8. Add scoring breakdown to run detail UI.

### Phase C — Governance Maturity (items 14, 16, 24)
9. Add run-level safety validation (hard-failure gates).
10. Implement policy versioning and version tagging on runs.
11. Unify world model consumption (remove hardcoded bounds).

### Phase D — Optimization Framework (items 7, 11)
12. Design safe action-space sampler.
13. Add formal immutable/tunable parameter separation.
14. Implement governance-bounded action selection.

### Phase E — Learning & Memory (items 12, 13, 17, 18)
15. Persist agent memory to database.
16. Add similarity-based strategy retrieval.
17. Implement bounded parameter auto-tuning.
18. Build cross-run learning pipeline.

### Phase F — Agent Intelligence (items 19, 20)
19. Add `replan_subpath` and `query_memory` tools to agentic planner.
20. Add post-run reflection and divergence explanation.

### Phase G — UI & Polish (items 21, 22, 25)
21. Add risk heatmap overlay to map.
22. Consolidate all panels into unified run dashboard.
23. Add mission destination semantics to UI.

### Phase H — Advanced (items 15, 26–28)
24. Add anti-reward-hacking protections.
25. Prepare post-hackathon release.
26. Evaluate full RL feasibility (offline only, with safety envelope).

---

## Key Files Reference

| Component | Primary File(s) |
|-----------|----------------|
| Execution loop | `backend/app/services/run_service.py` |
| Governance engine | `backend/app/services/governance_engine.py` |
| Policy rules | `backend/app/policies/rules_python.py` |
| Policy catalog | `backend/app/policies/policy_catalog.yaml` |
| Gemini planner | `backend/app/services/gemini_planner.py` |
| Agentic planner | `backend/app/services/agentic_planner.py` |
| Agent router | `backend/app/services/agent_service.py` |
| LLM endpoints | `backend/app/api/routes_llm.py` |
| Run endpoints | `backend/app/api/routes_runs.py` |
| Mission endpoints | `backend/app/api/routes_missions.py` |
| Operator endpoints | `backend/app/api/routes_operator.py` |
| Simulator | `sim/mock_sim/server.py` |
| World definition | `sim/mock_sim/world.json` |
| Run detail UI | `frontend/src/app/runs/[runId]/page.tsx` |
| Mission list UI | `frontend/src/app/missions/page.tsx` |
| Map component | `frontend/src/components/Map2DEnhanced.tsx` |
| API client | `frontend/src/lib/api.ts` |
