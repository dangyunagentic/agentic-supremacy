#!/usr/bin/env bash
# scripts/deploy.sh - push code and restart services from your machine.
set -euo pipefail

VPS_IP=${1:?'Usage: ./deploy.sh <vps-ip>'}
REMOTE_DIR=/opt/mintbot

echo "Deploying to $VPS_IP:$REMOTE_DIR ..."

rsync -avz --exclude node_modules --exclude .git --exclude dist --exclude .next \
  ./ "$VPS_IP:$REMOTE_DIR/"

ssh "$VPS_IP" bash -c "
  cd $REMOTE_DIR
  docker compose -f docker-compose.prod.yml up -d --build
  docker compose -f docker-compose.prod.yml exec -T api node -e \"console.log('api up')\"
  docker image prune -f
"

echo "Deployed."
