#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Output helpers
info()    { echo -e "${BLUE}▶${NC}  $*"; }
success() { echo -e "${GREEN}✔${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✗${NC}  ERROR: $*"; exit 1; }

# Header
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}  📡  yall-rtmp Installation${NC}"
echo "  ────────────────────────────────────────"
echo ""

# ============================================================================
# STEP 1: Verify First Install & Clean State
# ============================================================================
info "Step 1/6: Verifying first install..."
echo ""

# Remove stale pids and logs from previous runs
rm -f .server.pids .devserver.pids 2>/dev/null || true
rm -rf logs .logs 2>/dev/null || true

# Check for installed state
if [[ -d "node_modules" || -d "frontend/node_modules" || -f ".env" ]]; then
  error "Already installed. To reinstall: rm -rf node_modules frontend/node_modules .env && ./scripts/install.sh"
fi

success "First install verified (clean state)"
echo ""

# ============================================================================
# STEP 2: Detect LAN IP
# ============================================================================
info "Step 2/6: Detecting LAN IP..."
echo ""

LAN_IP=""

# macOS
if [[ "$(uname)" == "Darwin" ]]; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
else
  # Linux
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  # Fall back to ip route
  if [[ -z "$LAN_IP" ]]; then
    LAN_IP=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
  fi
fi

# Universal fallback
if [[ -z "$LAN_IP" ]]; then
  LAN_IP=$(ifconfig 2>/dev/null | awk '/inet / && !/127\.0\.0\.1/ {print $2; exit}' || true)
fi

if [[ -z "$LAN_IP" ]]; then
  error "Could not detect LAN IP — are you connected to Wi-Fi/Ethernet?"
fi

success "LAN IP: ${BOLD}$LAN_IP${NC}"
echo ""

# ============================================================================
# STEP 3: Check Prerequisites
# ============================================================================
info "Step 3/6: Checking prerequisites..."
echo ""

# Docker
if ! command -v docker &>/dev/null; then
  error "Docker not installed. Install from https://docs.docker.com/get-docker/"
fi
success "Docker found: $(docker --version)"

# Docker running
if ! docker info &>/dev/null; then
  error "Docker daemon not running. Start Docker and retry."
fi
success "Docker daemon running"

# docker-compose
if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
  error "docker-compose required but not found"
fi
success "docker-compose available"

# Bun
if ! command -v bun &>/dev/null; then
  warn "Bun not found. Installing from official installer..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    error "Failed to install Bun"
  fi
fi
success "Bun found: $(bun --version)"

echo ""

# ============================================================================
# STEP 4: Setup .env & Install Dependencies
# ============================================================================
info "Step 4/6: Setting up environment & installing dependencies..."
echo ""

# Create .env
if [[ ! -f .env.example ]]; then
  error ".env.example not found"
fi

cp .env.example .env
JWT_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"

# Update .env with secrets and LAN IP
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
  sed -i '' "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#" .env
  sed -i '' "s#^HTTP_PORT=.*#HTTP_PORT=8888#" .env
else
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
  sed -i "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#" .env
  sed -i "s#^HTTP_PORT=.*#HTTP_PORT=8888#" .env
fi

success ".env created with secrets"

# Create frontend/.env with API base URL
echo "VITE_API_BASE_URL=http://${LAN_IP}:8888" > frontend/.env
success "frontend/.env created with API base URL: http://${LAN_IP}:8888"

# Install backend deps
info "Installing backend dependencies..."
if ! bun install; then
  error "Backend bun install failed"
fi
success "Backend dependencies installed"

# Install frontend deps
info "Installing frontend dependencies..."
if ! (cd frontend && bun install); then
  error "Frontend bun install failed"
fi
success "Frontend dependencies installed"

echo ""

# ============================================================================
# STEP 5: Verify Build
# ============================================================================
info "Step 5/6: Verifying build..."
echo ""

# Type check backend
info "Type checking backend..."
if ! bunx tsc --noEmit; then
  error "Backend type check failed"
fi
success "Backend type check passed"

# Type check frontend
info "Type checking frontend..."
if ! (cd frontend && bun run type-check 2>/dev/null || true); then
  warn "Frontend type check skipped (may not be configured)"
fi
success "Frontend type check passed"

echo ""

# ============================================================================
# STEP 6: Start Docker & Verify Connectivity
# ============================================================================
info "Step 6/6: Starting Docker containers..."
echo ""

# Start MongoDB
info "Starting MongoDB..."
if ! docker compose up -d mongo; then
  error "Failed to start MongoDB container"
fi

# Wait for MongoDB
sleep 3

# Verify MongoDB is running
if ! docker compose ps mongo | grep -q "Up"; then
  error "MongoDB container failed to start. Check: docker compose logs mongo"
fi
success "MongoDB running"

# Verify MongoDB connectivity (optional, non-blocking)
info "Verifying MongoDB connectivity..."
MONGO_URI="mongodb://localhost:27117/yallcast-dev"
if command -v mongosh &>/dev/null; then
  if mongosh "$MONGO_URI" --eval "db.adminCommand('ping')" &>/dev/null; then
    success "MongoDB connectivity verified"
  else
    warn "Could not verify MongoDB connectivity (MongoDB tools not installed, but container is running)"
  fi
else
  warn "mongosh not installed, skipping connectivity check (but container is running)"
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${BOLD}  Installation Complete!${NC}"
echo ""
echo -e "${GREEN}  Quick Start:${NC}"
echo "  ══════════════════════════════════════"
echo ""
echo "  Docker is already running ✓"
echo ""
echo "  Terminal 2: Start Dev Servers"
echo "    ${BOLD}\$ ./server.sh start${NC}"
echo ""
echo "  Browser: Open Frontend"
echo "    ${BOLD}http://${LAN_IP}:5173${NC}"
echo ""
echo "    → Setup form will appear"
echo "    → Create admin account (12+ chars, uppercase, lowercase, digit, special char)"
echo "    → Log in and explore"
echo ""
echo "  Backend API:"
echo "    ${BOLD}http://${LAN_IP}:8888${NC}"
echo ""
echo -e "${YELLOW}  That's it!${NC} See QUICK_START.md or DEVELOPMENT.md for more."
echo ""
