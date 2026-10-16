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

# === Detect LAN IP ===
info "Detecting LAN IP..."

LAN_IP=""

# macOS
if [[ "$(uname)" == "Darwin" ]]; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
else
  # Linux
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  if [[ -z "$LAN_IP" ]]; then
    LAN_IP=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
  fi
fi

# Universal fallback
if [[ -z "$LAN_IP" ]]; then
  LAN_IP=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print $2; exit}' || true)
fi

if [[ -z "$LAN_IP" ]]; then
  warn "Could not detect LAN IP, using localhost (may not work on remote networks)"
  LAN_IP="localhost"
fi

success "LAN IP: $LAN_IP"

# === Load HTTP_PORT from .env ===
info "Loading HTTP_PORT from .env..."

if [[ ! -f .env ]]; then
  error ".env not found. Run ./scripts/install.sh first"
fi

HTTP_PORT=$(grep "^HTTP_PORT=" .env | cut -d'=' -f2 || echo "8888")
if [[ -z "$HTTP_PORT" ]]; then
  HTTP_PORT="8888"
fi

success ".env configured (HTTP_PORT=$HTTP_PORT)"

# === Check Prerequisites ===
info "Checking prerequisites..."

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
  if curl -sf "http://${LAN_IP}:${HTTP_PORT}/health" > /dev/null 2>&1; then
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

if ! curl -sf -X POST "http://${LAN_IP}:${HTTP_PORT}/auth/register" \
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
echo "  URL:      http://${LAN_IP}:${HTTP_PORT}"
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
