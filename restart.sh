#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}➜${NC}  $1"; }
log_error() { echo -e "${RED}✗${NC}  $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC}  $1"; }

log_info "Killing all processes by PID..."

# Kill by process name (most reliable)
pkill -9 -f "bun.*src/index" || true
pkill -9 -f "bun run dev" || true
pkill -9 -f "node.*vite" || true
pkill -9 -f "vite" || true
pkill -9 "bun" || true

# Clean up pid files
rm -f .server.pids .devserver.pids /tmp/stagebox-*.pid 2>/dev/null || true

sleep 1

# Verify everything is dead
if pgrep -f "bun" > /dev/null; then
  log_warn "Some bun processes still alive, force killing..."
  pkill -9 bun || true
  sleep 1
fi

log_info "Processes killed. Cleaning logs..."
rm -rf logs .logs

log_info "Starting fresh..."
./start-docker.sh start
./server.sh start
