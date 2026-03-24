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

# ---- Domain config (override via first argument) ----
DOMAIN="${1:-sovereignroboticsops.nov-tia.com}"
ADMIN_EMAIL="${2:-admin@nov-tia.com}"

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
mkdir -p /etc/sro || { echo "ERROR: Failed to create /etc/sro"; exit 1; }

if [ -f "$ENV_FILE" ]; then
  echo "Using existing env file at $ENV_FILE"
else
  echo "Creating env file at $ENV_FILE"
  cat > "$ENV_FILE" <<ENVFILE
GEMINI_API_KEY=${GEMINI_API_KEY:?Set GEMINI_API_KEY before running deploy}
GEMINI_PROJECT_ID=${GEMINI_PROJECT_ID:-gen-lang-client-0517520000}
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
SIM_TOKEN=${SIM_TOKEN:-$(openssl rand -hex 32)}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -hex 32)}
NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE:-https://${DOMAIN}/api}
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

# ---- Wait for backend health ----
echo "Waiting for backend to become healthy..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo "Backend healthy after ${i} attempts."
    break
  fi
  [ "$i" -eq 30 ] && { echo "WARNING: Backend not healthy after 30 attempts"; }
  sleep 2
done

# ---- Set up Nginx reverse proxy ----
cat > /etc/nginx/sites-available/sro <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # -- Security headers (applied to all locations) --
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

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
    location ~ ^/(health|docs|redoc|openapi\\.json|ws) {
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
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect -m "${ADMIN_EMAIL}"

# ---- After certbot rewrites the config, inject HSTS ----
if ! grep -q "Strict-Transport-Security" /etc/nginx/sites-available/sro; then
  sed -i '/listen 443 ssl/a\    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' \
    /etc/nginx/sites-available/sro 2>/dev/null || true
  nginx -t && systemctl reload nginx
fi

# ---- Set up daily database backup cron ----
BACKUP_DIR="/var/backups/sro-postgres"
mkdir -p "$BACKUP_DIR"
cat > /etc/cron.daily/sro-db-backup <<'CRON'
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/var/backups/sro-postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker compose -f /opt/sovereign-robotics-ops/docker-compose.vultr.yml exec -T db \
  pg_dump -U sro -d sro | gzip > "${BACKUP_DIR}/sro_${TIMESTAMP}.sql.gz"
# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "sro_*.sql.gz" -mtime +7 -delete
CRON
chmod +x /etc/cron.daily/sro-db-backup

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "  Site:      https://${DOMAIN}"
echo "  API Docs:  https://${DOMAIN}/docs"
echo "  Health:    https://${DOMAIN}/health"
echo "  DB Backup: ${BACKUP_DIR} (daily, 7-day retention)"
echo "=============================================="
