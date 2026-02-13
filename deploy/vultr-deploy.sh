#!/bin/bash
set -euo pipefail

# ============================================================
# Sovereign Robotics Ops - Vultr Deployment Script
# Run this on the Vultr VM as root
# ============================================================

REPO_URL="https://github.com/othnielObasi/sovereign-robotics-ops.git"
APP_DIR="/opt/sovereign-robotics-ops"

echo "=== Sovereign Robotics Ops - Vultr Deploy ==="

# ---- Clone or update repo ----
if [ -d "$APP_DIR" ]; then
  echo "Updating existing repo..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "Cloning repo..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---- Create .env file ----
cat > "$APP_DIR/.env" <<'ENVFILE'
GEMINI_API_KEY=AIzaSyACCEq4ODWv85ISP_uNFMyCYCzLG3lQj0A
GEMINI_PROJECT_ID=gen-lang-client-0517520000
JWT_SECRET=vultr-sro-jwt-secret-2026-hackathon
SIM_TOKEN=vultr-sro-sim-token-2026-hackathon
ENVFILE

echo "Created .env"

# ---- Open firewall ports ----
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw allow 8080/tcp 2>/dev/null || true
ufw allow 3000/tcp 2>/dev/null || true

# ---- Build and launch ----
echo "Building Docker images (this may take a few minutes)..."
docker compose -f docker-compose.vultr.yml build --no-cache

echo "Starting services..."
docker compose -f docker-compose.vultr.yml up -d

# ---- Set up Nginx reverse proxy ----
cat > /etc/nginx/sites-available/sro <<'NGINX'
server {
    listen 80 default_server;
    server_name _;

    # Frontend
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

    # Backend API
    location ~ ^/(health|missions|runs|governance|compliance|sim|llm|auth|docs|openapi\.json|ws) {
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
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/sro /etc/nginx/sites-enabled/sro
nginx -t && systemctl reload nginx

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "  Frontend:  http://104.238.128.128"
echo "  Backend:   http://104.238.128.128:8080"
echo "  API Docs:  http://104.238.128.128:8080/docs"
echo "  Health:    http://104.238.128.128/health"
echo "=============================================="
