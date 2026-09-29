#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Ya'll Cast — Local Install
#  https://github.com/HSchreier/yall-rtmp-docker-stream
# ─────────────────────────────────────────────────────────────────────────────
# Mirrors the shape of Stagebox's own scripts/install-mac.sh — check each
# prerequisite, install what's safe to install automatically (Bun, via its
# own official installer), stop and hand off for anything that needs a GUI
# or license acceptance (Docker Desktop), then wire up .env and start
# everything. Cross-platform (macOS/Linux) since Bun + Docker both are —
# this project has no macOS-only dependency the way Stagebox's ffmpeg/
# Homebrew install does.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}▶${NC}  $*"; }
success() { echo -e "${GREEN}✔${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
die()     { echo -e "${RED}✖${NC}  $*"; exit 1; }

# `clear` fails outright when TERM isn't set — true for some CI/automation
# shells and minimal SSH sessions, not just interactive terminals. Cosmetic
# only, so degrade quietly rather than let it kill the whole script.
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}  📡  Ya'll Cast — Local Install${NC}"
echo "  ────────────────────────────────────────"
echo "  Repo      https://github.com/HSchreier/yall-rtmp-docker-stream"
echo "  Status    v0.1.0-alpha.1 — the RTMP relay itself doesn't exist yet,"
echo "            this sets up the control-plane app (auth, profiles, dashboard)."
echo ""

# ── Bun ──────────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  info "Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  success "Bun installed"
else
  success "Bun $(bun --version)"
fi

# ── Docker ───────────────────────────────────────────────────────────────────
# Not auto-installed: Docker Desktop needs a GUI install and license
# acceptance on both macOS and most Linux distros' package managers vary
# enough that a blind `apt install docker.io` would be the wrong call on
# plenty of systems. Guide, don't guess.
if ! command -v docker &>/dev/null; then
  die "Docker not found. Install it from https://docs.docker.com/get-docker/, then re-run this script."
fi
if ! docker info &>/dev/null; then
  die "Docker is installed but not running. Start Docker, then re-run this script."
fi
success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── .env ─────────────────────────────────────────────────────────────────────
if [[ -f .env ]]; then
  warn ".env already exists — leaving it as-is. Delete it first if you want a fresh JWT_SECRET."
else
  cp .env.example .env
  # A real random secret, not the empty placeholder from .env.example —
  # openssl is present on every platform this script targets (macOS ships
  # it, every mainstream Linux distro's base image has it or gets it via
  # the package manager Docker itself already required above).
  JWT_SECRET="$(openssl rand -hex 32)"
  # Portable in-place sed: BSD sed (macOS) requires an explicit (empty)
  # backup-suffix argument after -i, GNU sed (Linux) doesn't accept one at
  # all in that position — the two are not drop-in compatible.
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
  else
    sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env
  fi
  success ".env created with a generated JWT_SECRET"
fi

# ── Dependencies ─────────────────────────────────────────────────────────────
info "Installing dependencies..."
bun install
success "Dependencies installed"

# ── Mongo ────────────────────────────────────────────────────────────────────
info "Starting Mongo (docker compose)..."
docker compose up -d mongo
success "Mongo running on localhost:27117"

echo ""
echo -e "${BOLD}  Done.${NC} Next:"
echo ""
echo "    bun run dev"
echo ""
echo "  Then open http://localhost:8080 — first visit walks you through"
echo "  creating the administrator account (no separate seed step needed)."
echo ""
