#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# SRO Build Demo — Interactive Terminal Script
#
# Records a self-paced walkthrough of the entire build pipeline.
# Designed for use with a screen recorder (OBS / Loom) or asciinema:
#
#   asciinema rec -t "SRO Build Demo" sro-build-demo.cast
#   bash scripts/demo_build.sh
#
# Each step pauses and waits for ENTER so you control the pacing.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

BOLD='\033[1m'
CYAN='\033[1;36m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
RESET='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── helpers ──────────────────────────────────────────────────────────

banner() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}  $1${RESET}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

narrate() {
  echo ""
  echo -e "${DIM}# $1${RESET}"
}

run_cmd() {
  echo -e "${GREEN}\$ $1${RESET}"
  eval "$1"
}

pause() {
  echo ""
  echo -e "${YELLOW}  ▸ Press ENTER to continue...${RESET}"
  read -r
}

# ── intro ────────────────────────────────────────────────────────────

clear
banner "Sovereign Robotics Ops — Build & Deploy Demo"
echo ""
echo "  This walkthrough covers:"
echo "    1. Project structure"
echo "    2. Environment setup"
echo "    3. Docker build (all services)"
echo "    4. Starting the stack"
echo "    5. Service verification"
echo "    6. Database migrations"
echo "    7. Running tests"
echo "    8. Production build overview"
echo ""
echo -e "  ${DIM}Working directory: $ROOT${RESET}"
pause

# ── 1. project structure ────────────────────────────────────────────

banner "1 / 8 — Project Structure"
narrate "Three services: backend (FastAPI), frontend (Next.js), simulator (FastAPI)"
run_cmd "tree -L 2 --dirsfirst -I 'node_modules|__pycache__|.git|*.egg-info|.next|sro_backend*' | head -50"
pause

# ── 2. environment ──────────────────────────────────────────────────

banner "2 / 8 — Environment Setup"
narrate "Copy .env.example and review the key variables."

if [[ -f .env.example ]]; then
  run_cmd "head -20 .env.example"
else
  echo -e "${DIM}  (.env.example not found — skipping preview)${RESET}"
fi

narrate "In development, JWT_SECRET and SIM_TOKEN auto-generate."
narrate "In production (ENVIRONMENT=production), they must be set explicitly."
pause

# ── 3. docker build ─────────────────────────────────────────────────

banner "3 / 8 — Docker Build"
narrate "Building all four containers: postgres, backend, simulator, frontend."

run_cmd "docker compose build 2>&1 | tail -20"

echo ""
narrate "Images built:"
run_cmd "docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | head -10"
pause

# ── 4. start stack ──────────────────────────────────────────────────

banner "4 / 8 — Start the Stack"
narrate "Launching all services. Backend waits for Postgres healthcheck,"
narrate "then runs Alembic migrations automatically on startup."

run_cmd "docker compose up -d"

echo ""
narrate "Waiting for backend to finish starting..."
sleep 5

run_cmd "docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
pause

# ── 5. verify services ─────────────────────────────────────────────

banner "5 / 8 — Verify Services"

narrate "Backend health check:"
run_cmd "curl -s http://localhost:8080/health | python3 -m json.tool || echo '  (backend not ready yet — may need a few more seconds)'"

echo ""
narrate "Simulator health check:"
run_cmd "curl -s http://localhost:8090/health || echo '  (simulator not ready)'"

echo ""
narrate "Frontend: http://localhost:3000"
narrate "API docs: http://localhost:8080/docs"
pause

# ── 6. database migrations ──────────────────────────────────────────

banner "6 / 8 — Database & Migrations"
narrate "Alembic migrations ran on startup. Checking current state:"

run_cmd "docker compose exec -T backend alembic -c /app/alembic.ini current 2>/dev/null || echo '  (could not reach backend container)'"

echo ""
narrate "Migration history:"
run_cmd "docker compose exec -T backend alembic -c /app/alembic.ini history 2>/dev/null | head -12 || echo '  (skipped)'"
pause

# ── 7. tests ────────────────────────────────────────────────────────

banner "7 / 8 — Running Tests"
narrate "Backend test suite — governance logic, API smoke tests, adversarial scenarios."

if command -v pytest &>/dev/null; then
  pushd backend >/dev/null
  run_cmd "pytest -q --tb=line 2>&1 | tail -15"
  popd >/dev/null
else
  narrate "pytest not installed locally — running inside container:"
  run_cmd "docker compose exec -T backend pytest -q --tb=line 2>&1 | tail -15 || echo '  (tests skipped — pytest not in image)'"
fi

echo ""
narrate "Frontend build verification (TypeScript check + production bundle):"
if [[ -d frontend/node_modules ]]; then
  pushd frontend >/dev/null
  run_cmd "npm run build 2>&1 | tail -5"
  popd >/dev/null
else
  echo -e "${DIM}  (node_modules not installed — run 'cd frontend && npm install' first)${RESET}"
fi
pause

# ── 8. production build ─────────────────────────────────────────────

banner "8 / 8 — Production Build (Vultr)"
narrate "Production uses docker-compose.vultr.yml with:"
narrate "  • Two isolated networks (frontend_net, backend_net)"
narrate "  • All ports bound to 127.0.0.1 (Nginx only)"
narrate "  • Resource limits: 512MB frontend, 1.5GB backend, 1GB Postgres, 256MB sim"
narrate "  • Health checks on every service"
narrate "  • JSON log rotation"

echo ""
narrate "Key differences from dev compose:"
run_cmd "diff --color=auto <(head -5 docker-compose.yml) <(head -20 docker-compose.vultr.yml) || true"

echo ""
narrate "CI/CD: every push to main triggers:"
echo "  • ci.yml          → backend tests + frontend build + Docker build"
echo "  • deploy.yml      → Fly.io (backend) + Vercel (frontend)"
echo "  • provision_vultr_env.yml → SSH deploy to Vultr VM"
pause

# ── wrap up ──────────────────────────────────────────────────────────

banner "Demo Complete"
echo ""
echo "  Services running:"
echo "    Dashboard:   http://localhost:3000"
echo "    API docs:    http://localhost:8080/docs"
echo "    Health:      http://localhost:8080/health"
echo "    Simulator:   http://localhost:8090/health"
echo ""
echo "  Documentation:"
echo "    Build guide:     docs/BUILD.md"
echo "    Architecture:    docs/architecture.md"
echo "    Demo script:     docs/demo-script.md"
echo ""
echo -e "${GREEN}  To stop: docker compose down${RESET}"
echo -e "${GREEN}  To stop + wipe DB: docker compose down -v${RESET}"
echo ""
