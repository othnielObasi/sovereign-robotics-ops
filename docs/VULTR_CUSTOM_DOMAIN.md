# Vultr Custom Domain Setup: sovereignroboticsops.nov-tia.com

Guide to move the Vultr deployment from a raw public IP to a custom subdomain with HTTPS.

## Overview

| Component | Before | After |
|-----------|--------|-------|
| Frontend | `http://104.238.128.128` | `https://sovereignroboticsops.nov-tia.com` |
| Backend API | `http://104.238.128.128:8080` | `https://sovereignroboticsops.nov-tia.com/health` |
| API Docs | `http://104.238.128.128:8080/docs` | `https://sovereignroboticsops.nov-tia.com/docs` |
| SSL | None | Let's Encrypt (auto-renewed) |

---

## Step 1 — Add DNS Record (Netlify DNS)

Domain `nov-tia.com` uses **Netlify DNS** (nameservers: `dns1.p09.nsone.net` → `dns4.p09.nsone.net`).

1. Go to [Netlify Dashboard](https://app.netlify.com) → **Domains** → **nov-tia.com** → **DNS settings**
2. Click **Add new record**:

| Field | Value |
|-------|-------|
| Type | **A** |
| Name | `sovereignroboticsops` |
| Value | `104.238.128.128` |
| TTL | `3600` |

3. Verify propagation:

```bash
# From any machine (dig, nslookup, or Google DNS API)
curl -s "https://dns.google/resolve?name=sovereignroboticsops.nov-tia.com&type=A" | python3 -m json.tool
```

Expected: `"data": "104.238.128.128"` in the Answer section.

---

## Step 2 — Code Changes Made

### 2a. `docker-compose.vultr.yml` — CORS origins

Updated CORS to use the domain instead of raw IP:

```yaml
# Before
CORS_ORIGINS: "http://104.238.128.128,http://104.238.128.128:3000,http://104.238.128.128:80,http://localhost:3000"

# After
CORS_ORIGINS: "https://sovereignroboticsops.nov-tia.com,http://sovereignroboticsops.nov-tia.com,http://localhost:3000"
```

Also locked down Postgres to localhost only:

```yaml
# Before
ports:
  - "5432:5432"

# After
ports:
  - "127.0.0.1:5432:5432"
```

### 2b. `frontend/src/lib/api.ts` — API base URL

Changed fallback from `http://localhost:8080` to empty string (same-origin):

```typescript
// Before
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

// After
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
```

### 2c. `frontend/src/lib/ws.ts` — WebSocket URL

Same change, plus handle empty API_BASE for WebSocket connections:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export function wsUrlForRun(runId: string) {
  if (typeof window !== "undefined" && !API_BASE) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/runs/${runId}`;
  }
  const u = new URL(API_BASE);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}/ws/runs/${runId}`;
}
```

### 2d. `frontend/src/app/page.tsx` — Dashboard API URL

```typescript
// Before
const API_URL = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

// After
const API_URL = process.env.NEXT_PUBLIC_API_BASE || "";
```

### 2e. `deploy/vultr-deploy.sh` — Nginx + SSL + Firewall

Key changes:
- Added `DOMAIN` variable at top of script
- `.env` sets `NEXT_PUBLIC_API_BASE=` (empty, for same-origin)
- Removed firewall rules for ports 8080 and 3000 (only 80/443 exposed)
- Nginx `server_name` set to the domain (was `_` catch-all)
- Added Certbot auto-install for free HTTPS with HTTP→HTTPS redirect

---

## Step 3 — Deploy on Vultr VM

### First time (full deploy):

```bash
ssh root@104.238.128.128
cd /opt/sovereign-robotics-ops
git pull origin main
bash deploy/vultr-deploy.sh
```

### If only frontend changed (faster):

```bash
ssh root@104.238.128.128
cd /opt/sovereign-robotics-ops
git pull origin main
docker compose -f docker-compose.vultr.yml build --no-cache frontend
docker compose -f docker-compose.vultr.yml up -d frontend
```

---

## Step 4 — Setup SSL (if not done by deploy script)

If Certbot didn't run during deploy, do it manually:

```bash
ssh root@104.238.128.128

# Open HTTPS port
ufw allow 443/tcp

# Install and run Certbot
apt-get update && apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d sovereignroboticsops.nov-tia.com \
  --non-interactive --agree-tos --redirect \
  -m admin@nov-tia.com
```

Certbot will:
1. Obtain a free Let's Encrypt certificate
2. Configure Nginx to serve HTTPS on port 443
3. Add automatic HTTP→HTTPS redirect
4. Auto-renew via systemd timer (check: `systemctl status certbot.timer`)

---

## Step 5 — Verify

```bash
# Health check
curl -s https://sovereignroboticsops.nov-tia.com/health | python3 -m json.tool

# Check HTTP redirects to HTTPS
curl -sI http://sovereignroboticsops.nov-tia.com/ | head -5

# Check SSL certificate
echo | openssl s_client -connect sovereignroboticsops.nov-tia.com:443 -servername sovereignroboticsops.nov-tia.com 2>/dev/null | openssl x509 -noout -subject -dates
```

---

## Troubleshooting

### "ERR_CONNECTION_REFUSED" on HTTPS
Port 443 not open or Certbot didn't run:
```bash
ufw allow 443/tcp
certbot --nginx -d sovereignroboticsops.nov-tia.com --non-interactive --agree-tos --redirect -m admin@nov-tia.com
```

### Frontend shows "Backend API Disconnected"
Frontend was built with old API URL. Rebuild:
```bash
docker compose -f docker-compose.vultr.yml build --no-cache frontend
docker compose -f docker-compose.vultr.yml up -d frontend
```

### DNS not resolving
Check with Google DNS:
```bash
curl -s "https://dns.google/resolve?name=sovereignroboticsops.nov-tia.com&type=A" | python3 -m json.tool
```
If no answer, the A record wasn't added in Netlify DNS.

### SSL certificate renewal
Certbot sets up auto-renewal. To test:
```bash
certbot renew --dry-run
```

---

## Architecture (after setup)

```
Browser → https://sovereignroboticsops.nov-tia.com
           │
           ▼
     ┌─── Nginx (port 443, SSL termination) ───┐
     │                                           │
     │  /                → localhost:3000 (Next.js frontend)
     │  /health          → localhost:8080 (FastAPI backend)
     │  /missions        → localhost:8080
     │  /runs            → localhost:8080
     │  /governance      → localhost:8080
     │  /compliance      → localhost:8080
     │  /sim             → localhost:8080
     │  /llm             → localhost:8080
     │  /auth            → localhost:8080
     │  /docs            → localhost:8080
     │  /ws/*            → localhost:8080 (WebSocket)
     └───────────────────────────────────────────┘
```

Ports 8080, 3000, and 5432 are **not** exposed to the internet.
