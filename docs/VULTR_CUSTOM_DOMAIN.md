# Vultr Custom Domain Deployment Guide

Complete guide for deploying Sovereign Robotics Ops on Vultr VM with a custom domain, HTTPS, and Nginx reverse proxy. Includes all issues encountered and solutions — intended as future deployment reference.

## Overview

| Component | Before (raw IP) | After (custom domain) |
|-----------|-----------------|----------------------|
| Frontend | `http://104.238.128.128` | `https://sovereignroboticsops.nov-tia.com` |
| Backend API | `http://104.238.128.128:8080/runs` | `https://sovereignroboticsops.nov-tia.com/api/runs` |
| API Docs | `http://104.238.128.128:8080/docs` | `https://sovereignroboticsops.nov-tia.com/docs` |
| Health | `http://104.238.128.128:8080/health` | `https://sovereignroboticsops.nov-tia.com/health` |
| WebSocket | `ws://104.238.128.128:8080/ws/runs/{id}` | `wss://sovereignroboticsops.nov-tia.com/ws/runs/{id}` |
| SSL | None | Let's Encrypt (auto-renewed via Certbot) |

**Key design:** Frontend API calls use the `/api` prefix (e.g., `/api/runs`, `/api/missions`). Nginx strips `/api` and forwards to the backend. This avoids routing conflicts where frontend pages and backend endpoints use the same path (e.g., `/runs`).

---

## Architecture

```
Browser → https://sovereignroboticsops.nov-tia.com
           │
           ▼
     ┌─── Nginx (port 443, SSL termination) ──────────────┐
     │                                                      │
     │  /api/*           → strip /api → localhost:8080      │
     │                     (FastAPI backend – all API calls) │
     │                                                      │
     │  /health          → localhost:8080 (direct)          │
     │  /docs            → localhost:8080 (Swagger UI)      │
     │  /openapi.json    → localhost:8080 (OpenAPI spec)    │
     │  /ws/*            → localhost:8080 (WebSocket)       │
     │                                                      │
     │  / (everything    → localhost:3000 (Next.js frontend)│
     │     else)                                            │
     └──────────────────────────────────────────────────────┘
           │
     Docker Compose containers:
     ├── backend   (port 8080, bound to 127.0.0.1 only)
     ├── frontend  (port 3000, bound to 127.0.0.1 only)
     ├── db        (postgres:16, port 5432, bound to 127.0.0.1 only)
     └── mock_sim  (port 8090, internal only)
```

Ports 8080, 3000, and 5432 are **not** exposed to the internet — only Nginx on 80/443.

---

## Step 1 — DNS Record (Netlify DNS)

Domain `nov-tia.com` uses **Netlify DNS** (nameservers: `dns1.p09.nsone.net` thru `dns4.p09.nsone.net`).

1. Go to [Netlify Dashboard](https://app.netlify.com) → **Domains** → **nov-tia.com** → **DNS settings**
2. Add an **A** record:

| Field | Value |
|-------|-------|
| Type | **A** |
| Name | `sovereignroboticsops` |
| Value | `104.238.128.128` |
| TTL | `3600` |

3. Verify propagation (may take a few minutes):

```bash
curl -s "https://dns.google/resolve?name=sovereignroboticsops.nov-tia.com&type=A" | python3 -m json.tool
```

Expected: `"data": "104.238.128.128"` in the Answer section.

---

## Step 2 — Code Changes (already applied)

### 2a. `docker-compose.vultr.yml`

**CORS origins** — changed from raw IP to domain:
```yaml
CORS_ORIGINS: "https://sovereignroboticsops.nov-tia.com,http://sovereignroboticsops.nov-tia.com,http://localhost:3000"
```

**Database hostname** — Docker Compose service is named `db`, not `postgres`:
```yaml
DATABASE_URL: "postgresql://sro:sro_production_2026@db:5432/sro"
```

**Postgres port** — locked to localhost only:
```yaml
ports:
  - "127.0.0.1:5432:5432"
```

**Backend port** — exposed to localhost for Nginx to reach:
```yaml
ports:
  - "127.0.0.1:8080:8080"
```

### 2b. `frontend/src/lib/api.ts` — API base URL

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";
```

All API calls (e.g., `listRuns`, `createMission`) go through `/api/runs`, `/api/missions`, etc.

### 2c. `frontend/src/lib/ws.ts` — WebSocket URL

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

export function wsUrlForRun(runId: string) {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/runs/${runId}`;
  }
  return `/ws/runs/${runId}`;
}
```

WebSocket connects directly to `/ws/runs/{id}` (no `/api` prefix needed — `/ws` doesn't conflict with any frontend page).

### 2d. `frontend/src/app/page.tsx` — Dashboard health check

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_BASE || "/api";
```

### 2e. `deploy/vultr-deploy.sh` — Nginx config

The deploy script writes the Nginx config with three location blocks:

1. **`/api/`** — Strips `/api` prefix, forwards to backend on port 8080
2. **`/health|/docs|/openapi.json|/ws`** — Direct to backend (no prefix stripping)
3. **`/` (catch-all)** — Everything else goes to the Next.js frontend on port 3000

---

## Step 3 — Deploy on Vultr VM

### Full deploy (first time or major changes):

```bash
ssh root@104.238.128.128
cd /opt/sovereign-robotics-ops
git pull origin main
bash deploy/vultr-deploy.sh
```

### Frontend-only rebuild (after API URL changes):

> **Important:** Next.js bakes `NEXT_PUBLIC_*` environment variables at build time.
> You MUST use `--no-cache` when rebuilding after changing `NEXT_PUBLIC_API_BASE`:

```bash
ssh root@104.238.128.128
cd /opt/sovereign-robotics-ops
git pull origin main
docker compose -f docker-compose.vultr.yml build --no-cache frontend
docker compose -f docker-compose.vultr.yml up -d frontend
```

### Backend-only restart:

```bash
docker compose -f docker-compose.vultr.yml up -d --force-recreate backend
```

---

## Step 4 — SSL Setup (Certbot)

The deploy script runs Certbot automatically. If it didn't, or you need to redo it:

```bash
ssh root@104.238.128.128

ufw allow 443/tcp
apt-get update && apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d sovereignroboticsops.nov-tia.com \
  --non-interactive --agree-tos --redirect \
  -m admin@nov-tia.com
```

**What Certbot does:**
1. Obtains a free Let's Encrypt certificate
2. Modifies Nginx to serve HTTPS on port 443
3. Adds HTTP→HTTPS redirect (port 80 → 443)
4. Sets up auto-renewal via systemd timer (`systemctl status certbot.timer`)

**Critical:** After Certbot modifies the Nginx config, the SSL server block may be MISSING the backend proxy rules. Certbot only copies the `server_name` and listen directives — it does NOT copy location blocks. You must manually verify the SSL block has all locations. See "Certbot Strips Nginx Locations" in Troubleshooting below.

---

## Step 5 — Update Nginx Manually After Certbot

Certbot creates an SSL block but may strip the proxy locations out. Here's the complete
working config for `/etc/nginx/sites-available/sro`:

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name sovereignroboticsops.nov-tia.com;

    if ($host = sovereignroboticsops.nov-tia.com) {
        return 301 https://$host$request_uri;
    }
    return 404;
}

# HTTPS server with all proxy rules
server {
    listen 443 ssl;
    server_name sovereignroboticsops.nov-tia.com;

    ssl_certificate /etc/letsencrypt/live/sovereignroboticsops.nov-tia.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sovereignroboticsops.nov-tia.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Backend API — /api prefix (strips /api, forwards to backend)
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # Backend direct routes (no prefix)
    location ~ ^/(health|docs|openapi\.json|ws) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # Frontend — everything else
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After writing the config:

```bash
nginx -t && systemctl reload nginx
```

---

## Step 6 — Verify Everything

```bash
# Health check (backend direct route)
curl -s https://sovereignroboticsops.nov-tia.com/health | python3 -m json.tool

# API through /api prefix (should return JSON list)
curl -s https://sovereignroboticsops.nov-tia.com/api/runs | head -c 200

# Swagger docs
curl -sI https://sovereignroboticsops.nov-tia.com/docs | head -3

# Frontend loads (should return HTML, not JSON)
curl -sI https://sovereignroboticsops.nov-tia.com/runs | head -3

# HTTP redirects to HTTPS
curl -sI http://sovereignroboticsops.nov-tia.com/ | head -5

# SSL certificate check
echo | openssl s_client -connect sovereignroboticsops.nov-tia.com:443 \
  -servername sovereignroboticsops.nov-tia.com 2>/dev/null | \
  openssl x509 -noout -subject -dates
```

---

## Issues Encountered & Fixes

### Issue 1: Port 5432 conflict — orphan containers

**Symptom:** `db` container fails to start: "address already in use :5432"

**Cause:** Previous Docker Compose runs left orphan postgres containers holding the port.

**Fix:**
```bash
docker compose -f docker-compose.vultr.yml down --remove-orphans
# If still held:
fuser -k 5432/tcp
docker compose -f docker-compose.vultr.yml up -d
```

### Issue 2: DATABASE_URL hostname mismatch

**Symptom:** Backend logs `connection refused` to postgres. Health endpoint returns 500.

**Cause:** `DATABASE_URL` used hostname `postgres` but Docker Compose service name is `db`.
Docker internal DNS only resolves the service name defined in docker-compose.yml.

**Fix:** In `docker-compose.vultr.yml`, change:
```yaml
# Wrong
DATABASE_URL: "postgresql://sro:sro_production_2026@postgres:5432/sro"
# Correct
DATABASE_URL: "postgresql://sro:sro_production_2026@db:5432/sro"
```

### Issue 3: Backend port not exposed to host

**Symptom:** Nginx returns `502 Bad Gateway` when proxying to `127.0.0.1:8080`.

**Cause:** Backend Docker container had no `ports:` mapping. The container listens on 8080 internally but Nginx on the host can't reach it.

**Fix:** Add port binding in `docker-compose.vultr.yml`:
```yaml
backend:
  ports:
    - "127.0.0.1:8080:8080"
```

Note: Bind to `127.0.0.1` only — do NOT expose to `0.0.0.0` or the API would be publicly accessible on port 8080, bypassing Nginx/SSL.

### Issue 4: Certbot strips Nginx location blocks

**Symptom:** After running Certbot, `/health` and all backend routes return the frontend page (200 HTML) instead of JSON.

**Cause:** Certbot creates an SSL `server {}` block on port 443 but only copies `server_name` and `listen` — it does NOT copy the `location` blocks from the HTTP block. So the SSL block has no proxy rules and falls through to the default root.

**Fix:** Manually edit `/etc/nginx/sites-available/sro` and copy all three location blocks (`/api/`, `/(health|docs|...)`, `/`) into the SSL server block. See Step 5 above for the complete config.

```bash
nano /etc/nginx/sites-available/sro
# Paste the full config from Step 5
nginx -t && systemctl reload nginx
```

### Issue 5: Frontend shows old baked-in API URL

**Symptom:** Browser dev tools Network tab shows frontend calling `http://localhost:8080/health` instead of `/api/health`.

**Cause:** Next.js bakes `NEXT_PUBLIC_*` environment variables into the JavaScript bundle at **build time**. A regular `docker compose up -d` reuses the cached Docker image with the old URL hardcoded in.

**Fix:** Always rebuild with `--no-cache` after changing any `NEXT_PUBLIC_*` var:
```bash
docker compose -f docker-compose.vultr.yml build --no-cache frontend
docker compose -f docker-compose.vultr.yml up -d frontend
```

### Issue 6: `/runs` page shows raw JSON instead of frontend

**Symptom:** Navigating to `https://sovereignroboticsops.nov-tia.com/runs/run_xxx` in the browser shows raw JSON `{"id":"run_xxx",...}` instead of the Next.js page.

**Cause:** When frontend and backend share the same origin, Nginx routes like `/runs` and `/missions` are ambiguous — both the Next.js frontend and FastAPI backend have endpoints at these paths. The Nginx regex `^/(runs|missions|...)` matched browser navigation to the frontend page and sent it to the backend.

**Fix:** Add an `/api` prefix for all frontend→backend API calls:
- Frontend code: `API_BASE = "/api"` — calls go to `/api/runs`, `/api/missions`, etc.
- Nginx: `/api/` location uses `rewrite ^/api/(.*) /$1 break` to strip the prefix before forwarding to the backend.
- Browser navigation to `/runs`, `/missions` now correctly reaches the frontend.
- Direct backend routes (`/health`, `/docs`, `/ws`) keep their paths since they don't conflict with any frontend page.

---

### Issue 7: Simulator unreachable — "Cannot reach simulator"

**Symptom:** Backend logs show `Cannot reach simulator` errors. Runs start but robot doesn't move. Sim telemetry returns empty or errors.

**Cause:** Three problems:
1. The `sim` container's Dockerfile (`sim/mock_sim/Dockerfile`) has **no CMD or ENTRYPOINT** — without an explicit `command:` in docker-compose, the container starts and immediately exits.
2. `SIM_BASE_URL` was not set in docker-compose, so the backend defaulted to `http://127.0.0.1:8090` — unreachable from inside the Docker network.
3. `depends_on` was backwards — sim depended on backend instead of backend depending on sim.

**Fix:**
- Added `command: uvicorn server:app --host 0.0.0.0 --port 8090` to the `sim` service in `docker-compose.vultr.yml`.
- Added `SIM_BASE_URL: "http://sim:8090"` to the backend environment — uses Docker's internal DNS.
- Fixed `depends_on` so backend depends on `[db, sim]`.
- Removed public port mapping for sim (no need to expose 8090 to the internet).

---

### Issue 8: Gemini API key revoked — LLM falls back to deterministic

**Symptom:** Planning always returns `"rationale": "[Fallback] Deterministic 2-waypoint plan."` and `"model_used": "deterministic_fallback"` instead of using Gemini.

**Cause:** The Gemini API key was hardcoded in `deploy/vultr-deploy.sh` and committed to the public GitHub repo. Google detected the leak and revoked it — API returns `403 PERMISSION_DENIED: "Your API key was reported as leaked"`.

**Fix:**
1. Removed the hardcoded key from `deploy/vultr-deploy.sh` — now requires `GEMINI_API_KEY` env var.
2. Generated a new API key at [Google AI Studio](https://aistudio.google.com/apikey).
3. Set the new key in `/opt/sovereign-robotics-ops/.env` on the VM.
4. Restarted the backend: `docker compose -f docker-compose.vultr.yml restart backend`.

**Prevention:** Never commit API keys to source code. Use `.env` files (gitignored) or secret management.

---

### Issue 9: Old GTC paper URL (`http://104.238.128.128:3000/`) unreachable

**Symptom:** The GTC paper references the old URL `http://104.238.128.128:3000/`. After migration, Docker binds the frontend to `127.0.0.1:3000` only, so the old URL doesn't work.

**Cause:** Nginx only listens on ports 80/443. Port 3000 on the *public* IP has nothing listening.

**Fix:** Added an Nginx server block that listens on the public IP's port 3000 and 301-redirects to the new domain:

```nginx
# In /etc/nginx/sites-available/sovereignroboticsops.nov-tia.com
server {
    listen 104.238.128.128:3000;
    server_name _;
    return 301 https://sovereignroboticsops.nov-tia.com$request_uri;
}
```

Key detail: `listen 104.238.128.128:3000` (public IP only) — Docker keeps `127.0.0.1:3000` for internal traffic. Paths are preserved, so `/missions` redirects to `https://sovereignroboticsops.nov-tia.com/missions`.

---

## Quick Reference Commands

```bash
# SSH to VM
ssh root@104.238.128.128

# Pull latest code
cd /opt/sovereign-robotics-ops && git pull origin main

# Rebuild and restart everything
docker compose -f docker-compose.vultr.yml down --remove-orphans
docker compose -f docker-compose.vultr.yml build --no-cache
docker compose -f docker-compose.vultr.yml up -d

# Rebuild frontend only
docker compose -f docker-compose.vultr.yml build --no-cache frontend
docker compose -f docker-compose.vultr.yml up -d frontend

# Check running containers
docker compose -f docker-compose.vultr.yml ps

# View backend logs
docker compose -f docker-compose.vultr.yml logs -f backend

# View frontend logs
docker compose -f docker-compose.vultr.yml logs -f frontend

# Check Nginx config and reload
nginx -t && systemctl reload nginx

# Check SSL certificate auto-renewal
certbot renew --dry-run

# Nuclear option — stop everything and start fresh
docker compose -f docker-compose.vultr.yml down --remove-orphans -v
fuser -k 5432/tcp 2>/dev/null
docker compose -f docker-compose.vultr.yml build --no-cache
docker compose -f docker-compose.vultr.yml up -d
```
