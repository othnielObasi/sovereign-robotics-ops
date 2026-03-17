# Production Roadmap — Sovereign Robotics Ops

> A phased plan to move SRO from hackathon prototype to production-ready deployment.

---

## Phase 1 — Security Hardening (Critical)

| Item | Issue | Action |
|---|---|---|
| Dev-token endpoint open | `POST /auth/dev-token` gives anyone a valid JWT with zero authentication | Gate behind `environment != "production"` or remove entirely |
| Auth off by default | `auth_required` defaults to `False` in `backend/app/config.py` | Default to `True`; require explicit env var override for dev only |
| Hardcoded DB password | `sro_production_2026` in plaintext in `docker-compose.vultr.yml` | Move to secret manager or `.env` file excluded from version control |
| JWT secret regenerates on restart | If `JWT_SECRET` env var is unset, every restart invalidates all tokens | Fail fast on startup if `JWT_SECRET` is unset in production |
| No HTTPS configuration | TLS only configured for Fly.io, not the Vultr deployment | Add Nginx + Let's Encrypt config or Caddy reverse proxy |
| No rate limiting | All endpoints unprotected from abuse | Add `slowapi` or equivalent middleware |
| Permissive CORS | `allow_methods=["*"], allow_headers=["*"]` in `main.py` | Restrict to actual methods (`GET, POST, PATCH, DELETE, OPTIONS`) and specific headers |
| Missing security headers | No CSP, HSTS, X-Frame-Options, X-Content-Type-Options | Add security middleware to both backend and frontend |

---

## Phase 2 — Database & Data Integrity

| Item | Issue | Action |
|---|---|---|
| No connection pooling | Default SQLAlchemy pool (5 connections) exhausts under load | Configure `pool_size=20`, `max_overflow=10`, `pool_timeout=30`, `pool_recycle=1800` |
| Alembic migration drift | ORM models define `MissionAudit`, mission `status`/`updated_at` with no corresponding migration | Generate new Alembic migration to match current models |
| Manual ALTER TABLE at startup | `_ensure_prev_hash_column()` and `_ensure_mission_columns()` bypass Alembic | Remove once Alembic migrations are aligned |
| No backup strategy | No database backup scripts or disaster recovery plan | Add `pg_dump` cron job + documented restore procedure |
| Shallow health check | `/health` returns `"ok"` without checking DB or simulator connectivity | Add DB ping and simulator reachability checks |

---

## Phase 3 — Testing & Reliability

| Item | Issue | Action |
|---|---|---|
| ~15–20% test coverage | No tests for auth, WebSocket, LLM routes, RunService loop, planners | Target 70%+ backend coverage |
| No frontend tests | Zero test infrastructure on the frontend | Add Jest + React Testing Library; test critical flows (run page, policy eval) |
| Silent exception swallowing | 10+ bare `except Exception: pass` blocks in `run_service.py` | Log at ERROR level; re-raise safety-critical failures |
| No load testing | Unknown performance under concurrent runs and WebSocket connections | Add k6 or Locust load tests for key endpoints |
| Duplicate `rehydrate_plans` method | Defined twice in `run_service.py`; second silently overwrites first | Remove the duplicate definition |

---

## Phase 4 — Dependency & Build Hygiene

| Item | Issue | Action |
|---|---|---|
| Backend deps unpinned | `>=` bounds only in `pyproject.toml` | Generate `requirements.lock` via `pip-compile` |
| Frontend deps loosely pinned | Caret ranges (`^`) in `frontend/package.json` | Commit `package-lock.json`; use `npm ci` in CI |
| Backend Dockerfile has no CMD | Image is not runnable standalone | Add `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]` |
| Frontend prod Dockerfile missing `public/` | Static assets break in production build | Add `COPY public/ ./public/` to the build stage |
| Minimal `.gitignore` | Missing `.env`, `*.log`, `.venv/`, `dist/`, IDE files | Expand to cover common patterns |

---

## Phase 5 — Observability & Operations

| Item | Issue | Action |
|---|---|---|
| Empty OTEL config | `infra/otel/` has no collector configuration | Add OTEL collector config; wire up backend traces |
| Phantom Grafana metrics | Dashboard references `governance_decisions_total` etc. that are never emitted | Add Prometheus metrics export via `prometheus-fastapi-instrumentator` |
| Basic logging only | Just `basicConfig()` — no JSON output, no correlation IDs | Switch to structured JSON logging (e.g., `structlog`) with request IDs |
| Sentry config exists but no SDK | `sentry_dsn` in config, `sentry-sdk` not installed | Add `sentry-sdk[fastapi]` to dependencies |
| No WebSocket graceful shutdown | Clients are abruptly disconnected on deploy | Close WebSocket connections cleanly in lifespan shutdown handler |

---

## Phase 6 — Production Infrastructure

| Item | Issue | Action |
|---|---|---|
| Multi-instance race condition | Manual ALTER TABLE at startup creates DDL race when scaling horizontally | Use Alembic + a pre-deploy migration step, not app-startup DDL |
| No CI/CD pipeline for tests | GitHub Actions exist for deploy but not for test or lint | Add CI workflow: lint → test → build → deploy |
| SimAdapter token mismatch | Dev token is randomly generated and won't match the simulator | Document required token matching; fail fast if misconfigured |
| No autoscaling | Single VM deployment | Move to Kubernetes or Fly.io machines with horizontal scaling |
| No frontend error boundary | Unhandled React error crashes entire UI | Add React error boundary component wrapping the app root |

---

## Suggested Timeline

| Timeframe | Phase | Focus |
|---|---|---|
| **Week 1–2** | Phase 1 — Security | Blocks everything else; exploitable today on any deployed instance |
| **Week 2–3** | Phase 2 — Database | Data integrity is non-negotiable for a governance system |
| **Week 3–5** | Phase 3 — Testing | Catch bugs before users do; critical for safety-critical software |
| **Week 5–6** | Phase 4 — Build Hygiene | Reproducible, reliable builds |
| **Week 6–8** | Phase 5 — Observability | Visibility into production behavior |
| **Week 8+** | Phase 6 — Infrastructure | Scale and automate deployment |

---

## Top 3 Immediate Actions

1. **Guard the `/auth/dev-token` endpoint** — disable or remove in production environments
2. **Enforce authentication** — set `AUTH_REQUIRED=true` in all production deployments
3. **Externalize all secrets** — remove hardcoded passwords from compose files; use environment variables or a secret manager

---

*Generated: March 2026*
