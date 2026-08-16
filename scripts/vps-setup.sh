#!/usr/bin/env bash
# scripts/vps-setup.sh - run on a fresh Ubuntu VPS as root.
set -euo pipefail

# ── System ──
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban

# ── Firewall ──
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# ── Docker ──
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# ── Project ──
mkdir -p /opt/mintbot
cd /opt/mintbot

if [ ! -d .git ]; then
  echo "Clone the repository into /opt/mintbot first, or rsync it from your machine."
fi

if [ ! -f .env.production ]; then
  cp .env.example .env.production
  echo "Edit .env.production before starting: nano .env.production"
fi

echo "Done. Start everything with:"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
echo "Caddy provisions TLS automatically once DNS points at this server."
