#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  yall-rtmp — Docker Installation Script
#  https://github.com/HSchreier/yall-rtmp-docker-stream
# ─────────────────────────────────────────────────────────────────────────────
# Comprehensive installation with:
# - Docker/docker-compose verification
# - User/group setup (sidecar non-root user)
# - Directory creation with correct chmod permissions
# - Environment configuration with secrets
# - Docker image build
# - Full error handling and logging

set -euo pipefail

# === Colors & Output ===
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

# === Logging ===
LOG_DIR=".logs"
LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

exec 1> >(tee -a "$LOG_FILE")
exec 2> >(tee -a "$LOG_FILE" >&2)

info()    { echo -e "${BLUE}▶${NC}  $(date '+%H:%M:%S')  $*"; }
success() { echo -e "${GREEN}✔${NC}  $(date '+%H:%M:%S')  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $(date '+%H:%M:%S')  $*"; }
error()   { echo -e "${RED}✖${NC}  $(date '+%H:%M:%S')  ERROR: $*"; exit 1; }

# === Cleanup on exit ===
trap 'if [ $? -ne 0 ]; then error "Installation failed. See logs: $LOG_FILE"; fi' EXIT

# === Header ===
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}  📡  yall-rtmp — Installation${NC}"
echo "  ────────────────────────────────────────"
echo "  RTMP Relay with Multi-Destination Support"
echo "  MongoDB + Nginx + Bun Sidecar (Docker)"
echo ""
info "Log file: $LOG_FILE"
echo ""

# === Docker Check ===
if ! command -v docker &>/dev/null; then
  error "Docker not found. Install from https://docs.docker.com/get-docker/"
fi

if ! docker info &>/dev/null; then
  error "Docker daemon not running. Start Docker and try again."
fi

success "Docker: $(docker --version)"

if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
  error "docker-compose required but not found"
fi

success "docker-compose available"

# === Setup .env ===
if [[ -f .env ]]; then
  warn ".env exists. Keeping existing configuration."
  info "To regenerate: rm .env && ./scripts/install.sh"
else
  info "Creating .env with generated secrets..."

  if [[ ! -f .env.example ]]; then
    error ".env.example not found"
  fi

  cp .env.example .env

  JWT_SECRET="$(openssl rand -hex 32)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"

  # Portable sed for macOS/Linux
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
    sed -i '' "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#" .env
  else
    sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
    sed -i "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#" .env
  fi

  success ".env created with secrets"
fi

# === Directory Setup ===
info "Setting up directories and permissions..."

mkdir -p .logs
chmod 755 .logs
success ".logs directory created (chmod 755)"

# Ensure /tmp/nginx exists (for error logs)
mkdir -p /tmp/nginx 2>/dev/null || true
chmod 777 /tmp 2>/dev/null || warn "Could not set /tmp permissions (may need sudo)"

success "Directories configured"

# === Docker Image Build ===
info "Building Docker image (this may take a few minutes)..."

if ! docker build -t yall-rtmp-relay:latest .; then
  error "Docker build failed. Check output above for details."
fi

success "Docker image built: yall-rtmp-relay:latest"

# === Verify ===
info "Verifying installation..."

if ! docker images | grep -q "yall-rtmp-relay"; then
  error "Image verification failed"
fi

for file in docker-compose.yml Dockerfile docker/nginx.conf.template src/index.ts; do
  if [[ ! -f "$file" ]]; then
    error "Required file missing: $file"
  fi
done

success "All required files present"

# === Summary ===
echo ""
echo -e "${BOLD}  Installation Complete!${NC}"
echo ""
echo "  Next steps:"
echo "  ──────────────────────────────────────"
echo "  1. Start services:    docker-compose up -d"
echo "  2. Check status:      docker-compose ps"
echo "  3. View logs:         docker-compose logs -f relay"
echo "  4. Open dashboard:    http://localhost:8080"
echo ""
echo "  Configuration:"
echo "  ──────────────────────────────────────"
echo "  - .env (secrets and URLs)"
echo "  - docker-compose.yml (ports, volumes)"
echo "  - docker/nginx.conf.template (RTMP settings)"
echo ""
echo -e "${YELLOW}  Note:${NC} First visit to http://localhost:8080 will prompt"
echo "  you to create an admin account."
echo ""
echo "  Logs:"
echo "  ──────────────────────────────────────"
echo "  - Installation:  $LOG_FILE"
echo "  - Runtime:       docker-compose logs relay"
echo "  - Errors:        .logs/nginx-error.log (container)"
echo ""
