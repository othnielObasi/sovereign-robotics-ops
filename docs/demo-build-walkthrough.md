# Build & Deploy Demo — Narration Script

> **Purpose:** Step-by-step walkthrough for screen-recording the full build
> process. Use with OBS, Loom, or any screen recorder. Estimated runtime: 5–6 minutes.

---

## Pre-Recording Checklist

- [ ] Clean terminal (white or dark theme, large font ≥ 16pt)
- [ ] No sensitive `.env` values visible — use placeholder passwords
- [ ] Docker running, ports 3000/8080/8090/5432 free
- [ ] Repository freshly cloned (or `docker compose down -v` to reset)

---

## Scene 1 — Project Overview (45 s)

**Show:** File explorer / `tree` output in terminal.

**Narration:**

> "Sovereign Robotics Ops is a three-service stack: a FastAPI backend that
> runs governance logic, a Next.js frontend dashboard, and a mock robot
> simulator. Let me walk through building and running everything."

**Commands:**

```bash
# Show the project structure
tree -L 2 --dirsfirst -I 'node_modules|__pycache__|.git|*.egg-info'
```

**Key points to highlight:**

| Directory        | What it is                              |
|------------------|-----------------------------------------|
| `backend/`       | Python 3.11 FastAPI — governance engine |
| `frontend/`      | Next.js 14 — operator dashboard         |
| `sim/mock_sim/`  | Mock robot simulator                    |
| `docker-compose.yml`        | Local dev orchestration    |
| `docker-compose.vultr.yml`  | Production orchestration   |
| `deploy/`        | Vultr deployment script                 |
| `.github/workflows/` | CI/CD pipelines                    |

---

## Scene 2 — Environment Setup (30 s)

**Narration:**

> "First, we set up environment variables. The project includes an example
> file. In development most values auto-generate, but production requires
> real secrets."

**Commands:**

```bash
# Copy the example env file
cp .env.example .env

# Show what's inside (highlight key vars)
cat .env.example
```

**Point out:** `DATABASE_URL`, `JWT_SECRET`, `SIM_TOKEN`, `GEMINI_API_KEY`.

---

## Scene 3 — Docker Build (60 s)

**Narration:**

> "The easiest way to build everything is Docker Compose. One command builds
> all four containers: Postgres, the backend, the simulator, and the frontend."

**Commands:**

```bash
# Build all images
docker compose build

# Show the built images
docker images | grep -E 'sovereign|sro|mock'
```

**While building, explain:**

- **Backend** (`backend/Dockerfile`): Multi-stage build — installs Python deps
  in a builder stage, then copies only the installed packages to a slim
  runtime image. Runs as a non-root `sro` user.
- **Frontend** (`frontend/Dockerfile`): Node 20 Alpine, installs npm deps.
  Production uses `Dockerfile.prod` with a separate build stage that bakes
  in `NEXT_PUBLIC_API_BASE`.
- **Simulator** (`sim/mock_sim/Dockerfile`): Lightweight Python image with
  just FastAPI and Uvicorn.

---

## Scene 4 — Launch the Stack (45 s)

**Narration:**

> "Now we bring everything up. The backend waits for Postgres to be healthy
> before starting, then automatically runs database migrations."

**Commands:**

```bash
# Start all services
docker compose up -d

# Watch logs — migrations run automatically
docker compose logs -f backend --tail=20
```

**Wait for:** `"Uvicorn running on http://0.0.0.0:8080"` in the logs.

```bash
# Verify all containers are healthy
docker compose ps
```

**Expected output:** Four containers, all `Up (healthy)` or `running`.

---

## Scene 5 — Verify Services (45 s)

**Narration:**

> "Let's verify each service is responding."

**Commands:**

```bash
# Backend health check
curl -s http://localhost:8080/health | python3 -m json.tool

# Simulator health check
curl -s http://localhost:8090/health

# Backend API docs
echo "API docs available at: http://localhost:8080/docs"

# Frontend
echo "Dashboard available at: http://localhost:3000"
```

**Show in browser:** Open `http://localhost:8080/docs` briefly (Swagger UI),
then `http://localhost:3000` (dashboard).

---

## Scene 6 — Database & Migrations (30 s)

**Narration:**

> "The backend uses Alembic for database migrations. They ran automatically
> on startup, but here's how to run them manually."

**Commands:**

```bash
# Check migration status
docker compose exec backend alembic -c /app/alembic.ini current

# View migration history
docker compose exec backend alembic -c /app/alembic.ini history --verbose | head -20
```

**Point out:** Hash-chained migration versions, auto-generated schema.

---

## Scene 7 — Running Tests (45 s)

**Narration:**

> "The backend has a full test suite covering governance logic, API endpoints,
> and adversarial scenarios."

**Commands:**

```bash
# Run backend tests
cd backend
pip install -e ".[dev]" -q
pytest -q --tb=short

# Return to root
cd ..
```

**Point out:** Test count, all passing, coverage of governance engine and
API smoke tests.

```bash
# Frontend build verification (type-check + production bundle)
cd frontend
npm install --silent
npm run build

cd ..
```

---

## Scene 8 — Production Build (60 s)

**Narration:**

> "For production on Vultr, we use a separate compose file with resource
> limits, health checks, network isolation, and TLS-ready Nginx configuration."

**Commands:**

```bash
# Show the production compose file
cat docker-compose.vultr.yml
```

**Highlight:**

- Two Docker networks (`frontend_net`, `backend_net`) — DB not accessible from frontend
- All ports bound to `127.0.0.1` — only Nginx can reach them
- Resource limits: 512 MB frontend, 1.5 GB backend, 1 GB Postgres, 256 MB sim
- Health checks on every service with retries and start periods

```bash
# Build production images
docker compose -f docker-compose.vultr.yml build
```

---

## Scene 9 — CI/CD Pipeline (30 s)

**Narration:**

> "Every push to main triggers three GitHub Actions workflows: CI tests,
> Fly.io + Vercel deployment, and an SSH deploy to the Vultr production server."

**Show:** Open `.github/workflows/` in the editor and briefly scroll through:

- `ci.yml` — tests + Docker build verification
- `deploy.yml` — Fly.io backend + Vercel frontend
- `provision_vultr_env.yml` — SSH into Vultr, pull code, rebuild containers

**Point out:** The deploy is fully automated — push to `main` and
production updates within minutes.

---

## Scene 10 — Wrap Up (15 s)

**Narration:**

> "That's the full build pipeline: Docker Compose for local dev, automated
> CI/CD for testing, and a production-hardened deployment on Vultr with
> Nginx, TLS, network isolation, and automated database backups.
> Full documentation is in `docs/BUILD.md`."

**Show:** Briefly open `docs/BUILD.md` in the editor.

---

## Quick Reference — All Commands

```bash
# Clone
git clone https://github.com/othnielObasi/sovereign-robotics-ops.git
cd sovereign-robotics-ops

# Setup
cp .env.example .env

# Build & run (dev)
docker compose build
docker compose up -d

# Verify
curl -s http://localhost:8080/health | python3 -m json.tool
curl -s http://localhost:8090/health
open http://localhost:3000

# Tests
cd backend && pytest -q && cd ..
cd frontend && npm run build && cd ..

# Production build
docker compose -f docker-compose.vultr.yml build

# Teardown
docker compose down -v
```
