# Architecture (MVP)

**Loop:** Telemetry → Agent proposes action → Governance evaluates → Execute → Append event → Stream to UI.

- **sim/mock_sim**: a minimal simulator that produces telemetry and accepts commands.
- **backend**: orchestrates runs and enforces governance.
- **frontend**: operator console (live telemetry + chain-of-trust timeline).

## Chain-of-trust event
Each decision creates an immutable event payload with:
- Context (state + perception summary)
- Proposal
- Governance decision (approve/deny/review + reasons)
- Execution (if approved)
- Hash (sha256 over canonical JSON)
