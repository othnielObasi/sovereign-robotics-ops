# Demo Script (3–4 minutes)

## Setup

Start the stack locally or use the live deployment:

```bash
docker-compose up -d
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080/docs
# Simulator: http://localhost:8090
```

---

## Act 1 — Safe Operation (30 s)

1. Open the **Dashboard** — show the 2D warehouse map with walking workers, idle robot, and dock bays.
2. **Create mission**: "Deliver to Bay 3" with goal `(x=15, y=7)`.
3. **Start run** — robot begins moving. Governance evaluates every tick → all APPROVED, policy state = SAFE.
4. Point out the **real-time event feed** and the hash-chained audit trail.

## Act 2 — Governance Intervention (60 s)

5. **Inject scenario** — `human_approach`:
   ```bash
   curl -X POST http://localhost:8090/scenario -H "Content-Type: application/json" \
     -d '{"scenario": "human_approach"}'
   ```
   - Governance switches to **SLOW** — speed reduced, `HUMAN_PROXIMITY_02` fires.
   - UI shows yellow status with risk score.

6. **Inject scenario** — `human_too_close`:
   ```bash
   curl -X POST http://localhost:8090/scenario -H "Content-Type: application/json" \
     -d '{"scenario": "human_too_close"}'
   ```
   - Governance triggers **STOP** — robot halts immediately.
   - Decision shows DENIED with risk > 0.9.

7. **Clear** and show audit events accumulating:
   ```bash
   curl -X POST http://localhost:8090/scenario -H "Content-Type: application/json" \
     -d '{"scenario": "clear"}'
   ```

## Act 3 — Operator Override & Pause/Resume (45 s)

8. **Pause the run** to simulate operator intervention:
   ```bash
   curl -X POST http://localhost:8080/runs/{run_id}/pause
   ```
   - INTERVENTION event logged in the audit trail.

9. **Resume** after clearing the area:
   ```bash
   curl -X POST http://localhost:8080/runs/{run_id}/resume
   ```

10. Show the **governance decision history**:
    ```bash
    curl http://localhost:8080/governance/decisions/{run_id}/stats
    ```
    Highlight: total decisions, approved vs denied counts, policy hit frequencies.

## Act 4 — Multi-Policy Stress (45 s)

11. **Inject `loading_bay_rush`** — compound scenario firing 3 policies simultaneously:
    ```bash
    curl -X POST http://localhost:8090/scenario -H "Content-Type: application/json" \
      -d '{"scenario": "loading_bay_rush"}'
    ```
    - SAFE_SPEED_01 + WORKER_PROXIMITY_06 + OBSTACLE_CLEARANCE_03 all fire.
    - Governance escalates to STOP/NEEDS_REVIEW.

12. **Show governance receipt** for the denial:
    ```bash
    curl http://localhost:8080/governance/receipts/{run_id}
    ```
    Highlight: structured proof with verdict, proposal, policy evaluation, and integrity hash.

## Act 5 — Policy Testing (30 s)

13. Open **Policies** page → click **Test Action**.
14. Submit MOVE_TO with high speed (0.8) in loading_bay zone → see deny reasons and risk score.
15. Submit again with compliant speed (0.3) → APPROVED.

---

## Key Talking Points

- **"Governance as computation"** — every action evaluated against 8 policies in < 20 ms
- **"Audit-ready chain of trust"** — SHA-256 hash-chained events, tamper-evident
- **"Operator always in control"** — pause, resume, override with full audit trail
- **"10 deterministic scenarios"** — reproducible policy testing for certification
- **"Circuit breaker"** — 3 consecutive denials auto-escalate to operator review
