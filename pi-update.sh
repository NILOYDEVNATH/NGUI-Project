#!/bin/bash
# Pull the latest project version on Raspberry Pi and restart the display service.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/pi/NGUI-Project}"
SERVICE_NAME="${SERVICE_NAME:-supabase-display}"

echo "Updating ${PROJECT_DIR}"
cd "${PROJECT_DIR}"

echo "Pulling latest code"
git pull --ff-only

echo "Installing Node dependencies"
npm install

echo "Checking JavaScript syntax"
node --check index.js
node --check displays_monitor.js
node --check displays_led.js

echo "Restarting ${SERVICE_NAME}"
sudo systemctl daemon-reload
sudo systemctl restart "${SERVICE_NAME}"

echo "Service status"
if ! sudo systemctl --no-pager --full status "${SERVICE_NAME}"; then
  echo ""
  echo "Recent logs:"
  sudo journalctl -u "${SERVICE_NAME}" -n 80 --no-pager
  exit 1
fi

echo ""
echo "Display should be available at:"
echo "  http://raspberrypi.local:8080"
