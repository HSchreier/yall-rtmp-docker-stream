#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  yall-rtmp — Post-Installation Setup
#  Starts services, runs health checks, creates admin account
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

LOG_DIR=".logs"
LOG_FILE="$LOG_DIR/setup-$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

exec 1> >(tee -a "$LOG_FILE")
exec 2> >(tee -a "$LOG_FILE" >&2)

info()    { echo -e "${BLUE}▶${NC}  $(date '+%H:%M:%S')  $*"; }
success() { echo -e "${GREEN}✔${NC}  $(date '+%H:%M:%S')  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $(date '+%H:%M:%S')  $*"; }
error()   { echo -e "${RED}✖${NC}  $(date '+%H:%M:%S')  ERROR: $*"; exit 1; }

trap 'if [ $? -ne 0 ]; then error "Setup failed. See: $LOG_FILE"; fi' EXIT

# === Header ===
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}  📡  yall-rtmp — Setup${NC}"
echo "  ────────────────────────────────────────"
echo ""
info "Log file: $LOG_FILE"

# === Check Prerequisites ===
info "Checking prerequisites..."

if [[ ! -f .env ]]; then
  error ".env not found. Run ./scripts/install.sh first"
fi
success ".env configured"

if ! command -v docker &>/dev/null; then
  error "Docker not found"
fi
success "Docker available"

# === Start Services ===
info "Starting Docker services..."

if ! docker compose up -d 2>&1 | tee -a "$LOG_FILE"; then
  error "Failed to start services"
fi
success "Services starting"

# === Health Check ===
info "Waiting for services to be ready (up to 30 seconds)..."

for i in {1..30}; do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    success "HTTP API ready"
    break
  fi
  if [ $i -eq 30 ]; then
    error "Service health check timeout. Run: docker-compose logs relay"
  fi
  sleep 1
  echo -n "."
done

echo ""

# === Admin Account Setup ===
info "Creating admin account..."

read -p "Admin email (default: admin@example.com): " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"

read -sp "Admin password (must have uppercase, lowercase, digit, special char): " ADMIN_PASSWORD
echo ""

if ! curl -sf -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" > /dev/null 2>&1; then
  error "Failed to create admin account. Check: docker-compose logs relay"
fi

success "Admin account created: $ADMIN_EMAIL"

# === Summary ===
echo ""
echo -e "${BOLD}  Setup Complete!${NC}"
echo ""
echo "  Dashboard:"
echo "  ──────────────────────────────────────"
echo "  URL:      http://localhost:8080"
echo "  Email:    $ADMIN_EMAIL"
echo ""
echo "  RTMP Connection:"
echo "  ──────────────────────────────────────"
echo "  Server:   rtmp://192.168.188.29:1935/ingest"
echo "  (Configure stream destination in dashboard)"
echo ""
echo "  Services Status:"
echo "  ──────────────────────────────────────"
docker-compose ps | tail -n +2 | while read -r line; do
  echo "  $line"
done
echo ""
echo "  Useful Commands:"
echo "  ──────────────────────────────────────"
echo "  docker-compose ps                  (check status)"
echo "  docker-compose logs -f relay       (tail logs)"
echo "  docker-compose down                (stop all services)"
echo "  docker-compose restart relay       (restart relay)"
echo ""
echo "  Logs:"
echo "  ──────────────────────────────────────"
echo "  Setup:       $LOG_FILE"
echo "  Container:   docker-compose logs relay"
echo "  Error log:   .logs/nginx-error.log (in container)"
echo ""
