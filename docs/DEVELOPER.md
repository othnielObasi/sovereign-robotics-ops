# Developer Guide (internal)

This document is the developer handbook for Sovereign Robotics Ops (previously
`copilot-instructions.md`). It contains architecture details, run lifecycle,
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

1. `start_run()` - Creates DB record, spawns asyncio task
2. `_run_loop()` - poll sim → planner → evaluate → append event → broadcast
3. `stop_run()` - Sets stop flag, marks status as "stopped"

## Useful Commands

Run locally using Docker Compose:

```bash
docker-compose up -d
# Frontend: http://localhost:3000
# Backend: http://localhost:8080/docs
```

## Where to look

- Governance engine: `backend/app/services/governance_engine.py`
- Policies: `backend/app/policies/rules_python.py`
- Run service: `backend/app/services/run_service.py`
- WebSocket hub: `backend/app/api/routes_ws.py`

---

**Last Updated:** 2026-02-15
