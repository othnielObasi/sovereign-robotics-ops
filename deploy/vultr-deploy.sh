#!/bin/bash
set -euo pipefail

# ============================================================
# Sovereign Robotics Ops - Vultr Deployment Script
# Run this on the Vultr VM as root
# ============================================================

REPO_URL="https://github.com/othnielObasi/sovereign-robotics-ops.git"
APP_DIR="/opt/sovereign-robotics-ops"
ENV_FILE="/etc/sro/.env"

echo "=== Sovereign Robotics Ops - Vultr Deploy ==="

# ---- Domain config ----
DOMAIN="sovereignroboticsops.nov-tia.com"

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

# ---- Load or create env file ----
mkdir -p /etc/sro

if [ -f "$ENV_FILE" ]; then
  echo "Using existing env file at $ENV_FILE"
else
  echo "Creating env file at $ENV_FILE"
  cat > "$ENV_FILE" <<ENVFILE
GEMINI_API_KEY=${GEMINI_API_KEY:?Set GEMINI_API_KEY before running deploy}
GEMINI_PROJECT_ID=${GEMINI_PROJECT_ID:-gen-lang-client-0517520000}
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
SIM_TOKEN=${SIM_TOKEN:-$(openssl rand -hex 16)}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}
NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE:-}
ENVFILE
  chmod 600 "$ENV_FILE"
fi

set -a
. "$ENV_FILE"
set +a

: "${GEMINI_API_KEY:?Missing GEMINI_API_KEY in $ENV_FILE}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $ENV_FILE}"

# ---- Open firewall ports ----
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true

# ---- Build and launch ----
echo "Building Docker images (this may take a few minutes)..."
docker compose --env-file "$ENV_FILE" -f docker-compose.vultr.yml build --pull

echo "Starting services..."
docker compose --env-file "$ENV_FILE" -f docker-compose.vultr.yml up -d --remove-orphans

# ---- Set up Nginx reverse proxy ----
cat > /etc/nginx/sites-available/sro <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Backend API — /api prefix (strips /api, forwards to backend)
    location /api/ {
        rewrite ^/api/(.*) /\$1 break;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # Backend direct routes (no /api prefix needed for these)
    location ~ ^/(health|docs|openapi\\.json|ws) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # Frontend — everything else
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/sro /etc/nginx/sites-enabled/sro
nginx -t && systemctl reload nginx

# ---- Install Certbot and obtain SSL certificate ----
echo "Setting up HTTPS with Let's Encrypt..."
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect -m admin@nov-tia.com

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "  Site:      https://${DOMAIN}"
echo "  API Docs:  https://${DOMAIN}/docs"
echo "  Health:    https://${DOMAIN}/health"
echo "=============================================="
