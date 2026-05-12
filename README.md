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

## 🛠 Deployment

### Fly.io (Backend)
```bash
fly auth login
fly launch --config fly.toml
fly secrets set DATABASE_URL="..."
fly deploy
```

### Vercel (Frontend)
```bash
cd frontend
vercel --prod
```

### Vultr (Hackathon Requirement)
See `DEPLOY_VULTR.md` for VM deployment instructions.

## 📋 Compliance Frameworks

The platform supports multiple compliance frameworks:

- **ISO/IEC 42001:2023** - AI Management System
- **EU AI Act** - Articles 9-15 for high-risk AI
- **NIST AI RMF** - GOVERN, MAP, MEASURE, MANAGE

## 👥 Team

**Sovereign AI Labs**

- Othniel Obasi - Founder & CEO
  - 10+ years AI product management
  - MSc Applied AI & Data Science
  - DeepLearning.AI Red Team Certified

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

**Launch & Fund Your Startup: AI Meets Robotics Hackathon**

February 6-15, 2026 | lablab.ai
