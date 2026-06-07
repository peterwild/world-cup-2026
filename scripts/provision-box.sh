#!/usr/bin/env bash
# One-time box setup AFTER `terraform apply` and AFTER DNS points at the static IP.
# Run ON the box (ssh ubuntu@<ip>), from anywhere:
#   curl -fsSL <raw-url>/scripts/provision-box.sh | bash -s -- <git-url> <domain>
# or clone first and run ./scripts/provision-box.sh <git-url> <domain>
#
# Assumes terraform user_data already installed node/nginx/pm2/certbot.
set -euo pipefail

REPO_URL="${1:?usage: provision-box.sh <git-clone-url> <domain>}"
DOMAIN="${2:?usage: provision-box.sh <git-clone-url> <domain>}"
APP_DIR="$HOME/world-cup-2026"

# 1. Clone (or reuse) the repo.
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# 2. Env file — must exist before build/start.
if [ ! -f .env.production ]; then
  cp deploy/.env.production.example .env.production
  echo "!! Created .env.production from the example — EDIT IT (ADMIN_KEY, passcode) then re-run."
  exit 1
fi

# 3. Install, build, start under pm2.
npm ci --no-audit --no-fund
npm run build
pm2 start npm --name world-cup-2026 -- start 2>/dev/null || pm2 restart world-cup-2026 --update-env
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | bash || true

# 4. nginx reverse proxy.
sudo cp deploy/nginx-cup.conf /etc/nginx/sites-available/cup
sudo ln -sf /etc/nginx/sites-available/cup /etc/nginx/sites-enabled/cup
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 5. SSL (Let's Encrypt). Needs DNS already pointing here.
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
  -m pwild@ptwconsultingllc.com --redirect ||
  echo "certbot failed — confirm DNS, then run: sudo certbot --nginx -d $DOMAIN"

echo "Done. https://$DOMAIN should be live."
