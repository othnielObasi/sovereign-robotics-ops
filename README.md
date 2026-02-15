# Sovereign Robotics Ops

> **Track 1: Autonomous Robotics Control in Simulation**
> 
> The governance layer for autonomous robot control. We're not building the robot brain — we're building the **robot conscience**.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11-blue.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/next.js-14-black.svg)](https://nextjs.org)

## 🎯 What We Do

Sovereign Robotics Ops is a **real-time governance layer** for autonomous robots that:

- **Evaluates every action** against configurable safety policies
- **Reacts to environmental changes** (humans, obstacles) with STOP/SLOW/REPLAN
- **Logs every decision** with SHA-256 cryptographic proof
- **Enables safe sim-to-real transfer** by governing behavior, not just logging it

## 🚀 Quick Start

```bash
# Clone and run
git clone <repo>
cd sovereign-robotics-ops
docker-compose up -d

# Access
# Frontend: http://localhost:3000
# Backend API: http://localhost:8080
# Demo Page: http://localhost:3000/demo
# API Docs: http://localhost:8080/docs
```

## 📁 Project Structure

```
sovereign-robotics-ops/
├── backend/                 # FastAPI backend (Python)
│   ├── app/
│   │   ├── api/            # REST endpoints
│   │   ├── services/       # Governance engine, compliance reports
│   │   ├── policies/       # Safety policy definitions
│   │   └── schemas/        # Pydantic models
├── frontend/               # Next.js dashboard (React)
│   └── src/
│       ├── app/           # Pages (demo, runs, policies)
│       └── components/    # Map2DEnhanced, Timeline, etc.
├── sim/                   # Mock robot simulator
├── infra/                 # Grafana, OpenTelemetry configs
└── .github/workflows/     # CI/CD pipelines
```

Developer guide: See [docs/DEVELOPER.md](docs/DEVELOPER.md) for internal
architecture, CI, and provisioning runbook.

## 🎮 Demo Scenarios

The `/demo` page includes 4 interactive scenarios:

| Scenario | Status | Risk | What Happens |
|----------|--------|------|--------------|
| Safe Operation | 🟢 SAFE | 0.15 | Robot moves freely |
| Human Approaching | 🟡 SLOW | 0.52 | Speed reduced |
| Human Too Close | 🔴 STOP | 0.85 | Robot halted |
| Path Blocked | 🔵 REPLAN | 0.45 | Recalculating route |

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/runs` | Create new run |
| POST | `/governance/evaluate` | Evaluate action |
| GET | `/governance/policies` | List policies |
| GET | `/compliance/report/{run_id}` | Generate compliance report |
| WS | `/ws/{run_id}` | Real-time updates |

## 📊 Governance Features

### Policy Engine
- Weighted policy scoring
- Configurable risk thresholds
- Sub-100ms evaluation

### Chain of Trust
- SHA-256 hash chain
- Tamper-proof audit trail
- Compliance report export

### Safety Policies
- `human-presence`: Deny if human within 1.5m
- `speed-limit`: Enforce max speed near humans
- `collision-risk`: Check path for obstacles
- `battery-threshold`: Warn if battery < 20%

## 🛠 Deployment (Vultr)

This project is packaged for deployment to a single Vultr VM per the hackathon requirements.

Quick deploy (recommended for reviewers):

```bash
# On the Vultr VM
git clone <repo>
cd sovereign-robotics-ops
docker compose -f docker-compose.vultr.yml up --build -d
```

Notes:
- The `docker-compose.vultr.yml` file configures the frontend and backend services for a single VM deployment.
- For serving large static assets (demo video), we recommend configuring a host webserver (nginx) as described in `DEPLOY_VULTR.md`.
- Use PostgreSQL in production; local dev may use SQLite via the compose configuration.

## 📦 Submission & Packaging

We provide a convenience packaging script and guidance for reviewers and judges.

- Use `scripts/package_submission.sh [path/to/sro_demo.mp4]` to create a release archive in `deploy/`.
- The script includes `frontend/`, `backend/`, `docker-compose.vultr.yml`, and (optionally) the demo video.
- See `deploy/README_SUBMISSION.md` for quick reviewer steps.

Status: NVIDIA Brev + Isaac Sim credits have been claimed; Isaac Sim integration is planned but not included in this submission.

## 📋 Compliance Frameworks

The platform supports multiple compliance frameworks:

- **ISO/IEC 42001:2023** - AI Management System
- **EU AI Act** - Articles 9-15 for high-risk AI
- **NIST AI RMF** - GOVERN, MAP, MEASURE, MANAGE

## 👥 Team

**Sovereign AI Labs**

- Othniel Agera - Founder & CEO
  - 10+ years AI product management
  - MSc Applied AI & Data Science
  - DeepLearning.AI Red Team Certified

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

**Launch & Fund Your Startup: AI Meets Robotics Hackathon**

February 6-15, 2026 | lablab.ai
