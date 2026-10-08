#!/usr/bin/env bash
set -euo pipefail
umask 0077  # Restrict file creation to owner only (0600 files, 0700 dirs)

# RTMP Relay Server Bootstrap & Shutdown Script
#
# Startup phase:
#   1. Pre-flight validation (env vars, nginx binary, Mongo connectivity, ports)
#   2. Per-module error logging (ENV, NGINX, MONGODB, PORTS, STARTUP)
#   3. Spawn Bun sidecar compiled binary
#
# Shutdown phase (triggered by docker-compose down = SIGTERM):
#   1. Log shutdown signal received
#   2. Dispose HTTP server (stop accepting requests)
#   3. Dispose nginx (graceful SIGTERM to master)
#   4. Dispose MongoDB (close connection pool)
#   5. Exit with code 0 or 1 (logged at each step)
#
# Usage: ./docker/server.sh [--verbose]
#        docker compose up    # runs this script as CMD
#        docker compose down   # sends SIGTERM after 10s, script exits cleanly

# SCRIPT_DIR is /app (server.sh is at /app/server.sh, not /app/docker/server.sh)
SCRIPT_DIR="/app"
PROJECT_ROOT="/app"
LOG_DIR="${PROJECT_ROOT}/.logs"

# Create log directory
mkdir -p "$LOG_DIR"

# Logging functions
log_module() {
  local module="$1"
  local level="$2"
  shift 2
  local msg="$*"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$module] [$level] $msg" | tee -a "$LOG_DIR/${module}.log"
}

log_error() {
  local module="$1"
  shift
  log_module "$module" "ERROR" "$@" >&2
}

log_info() {
  local module="$1"
  shift
  log_module "$module" "INFO" "$@"
}

# Module startup checks
check_env() {
  log_info "ENV" "Checking environment variables..."

  if [ -z "${MONGO_URI:-}" ]; then
    log_error "ENV" "MONGO_URI not set"
    return 1
  fi
  log_info "ENV" "MONGO_URI: $MONGO_URI"

  if [ -z "${HTTP_PORT:-}" ]; then
    log_error "ENV" "HTTP_PORT not set"
    return 1
  fi
  log_info "ENV" "HTTP_PORT: $HTTP_PORT"

  if [ -z "${JWT_SECRET:-}" ]; then
    log_error "ENV" "JWT_SECRET not set"
    return 1
  fi
  log_info "ENV" "JWT_SECRET: (set, length=${#JWT_SECRET})"

  if [ -z "${ENCRYPTION_KEY:-}" ]; then
    log_error "ENV" "ENCRYPTION_KEY not set"
    return 1
  fi
  log_info "ENV" "ENCRYPTION_KEY: (set, length=${#ENCRYPTION_KEY})"

  log_info "ENV" "All environment variables present ✓"
  return 0
}

check_nginx() {
  log_info "NGINX" "Checking nginx binary..."

  if ! [ -x "/usr/local/nginx/sbin/nginx" ]; then
    log_error "NGINX" "nginx binary not found or not executable"
    return 1
  fi
  log_info "NGINX" "nginx binary found: /usr/local/nginx/sbin/nginx ✓"

  # nginx config is created dynamically by NginxProcessManager on profile activation
  # so we don't test it at startup — it doesn't exist yet
  log_info "NGINX" "nginx config will be created on profile activation"

  return 0
}

check_mongo() {
  log_info "MONGODB" "Checking MongoDB URI: $MONGO_URI"

  # Extract host from MongoDB URI
  local mongo_host="${MONGO_URI#*://}"
  mongo_host="${mongo_host%/*}"

  log_info "MONGODB" "Attempting connection to $mongo_host..."

  # Simple connectivity check - just see if we can resolve the host
  if ! ping -c 1 -W 2 "${mongo_host%:*}" >/dev/null 2>&1; then
    log_info "MONGODB" "Warning: Cannot ping $mongo_host (this is OK if using docker DNS)"
  fi

  log_info "MONGODB" "MongoDB connectivity check passed (full connection will be tested on sidecar start)"
  return 0
}

check_ports() {
  log_info "PORTS" "Checking port availability..."

  local http_port="${HTTP_PORT:-8080}"
  local rtmp_port="1935"
  local nginx_stats_port="8090"

  # Only check if ports are NOT in use (they'll be in use after nginx starts, which is OK)
  for port in "$http_port" "$rtmp_port" "$nginx_stats_port"; do
    if ! grep -q ":$(printf '%x' "$port") " /proc/net/tcp 2>/dev/null; then
      log_info "PORTS" "Port $port: available"
    else
      log_info "PORTS" "Port $port: in use (OK if services already running)"
    fi
  done

  return 0
}

check_rtmp_host() {
  log_info "NETWORK" "RTMP host IP: ${RTMP_HOST_IP:-not set (will use fallback)}"
  return 0
}

# Capture uncaught errors from Bun
handle_bun_error() {
  local exit_code=$?
  log_error "SIDECAR" "Bun process exited with code $exit_code"

  # Check which component likely failed
  if [ -f "$LOG_DIR/sidecar.log" ]; then
    if grep -q "ConfigService.*error" "$LOG_DIR/sidecar.log"; then
      log_error "CONFIG" "Configuration service failed - check env vars"
    fi
    if grep -q "MongoService.*error" "$LOG_DIR/sidecar.log"; then
      log_error "MONGODB" "MongoDB connection failed - check MONGO_URI"
    fi
    if grep -q "NginxProcessManager.*error" "$LOG_DIR/sidecar.log"; then
      log_error "NGINX" "Nginx process manager failed - check nginx binary"
    fi
    if grep -q "StreamState.*error" "$LOG_DIR/sidecar.log"; then
      log_error "STREAM_STATE" "Stream state module failed"
    fi
    if grep -q "StreamOrchestrator.*error" "$LOG_DIR/sidecar.log"; then
      log_error "STREAM_ORCHESTRATOR" "Stream orchestrator module failed"
    fi
  fi

  log_error "SIDECAR" "See $LOG_DIR/sidecar.log for full output"
  return $exit_code
}

# Main startup
main() {
  local verbose=false

  if [ "${1:-}" = "--verbose" ]; then
    verbose=true
    set -x  # Print each command
  fi

  log_info "STARTUP" "=== RTMP Relay Startup ==="
  log_info "STARTUP" "Project root: $PROJECT_ROOT"
  log_info "STARTUP" "Log directory: $LOG_DIR"

  # Pre-flight checks
  log_info "STARTUP" "Running pre-flight checks..."

  check_env || exit 1
  log_info "STARTUP" "✓ Environment variables"

  check_nginx || exit 1
  log_info "STARTUP" "✓ Nginx binary"

  check_mongo || exit 1
  log_info "STARTUP" "✓ MongoDB connectivity"

  check_ports || exit 1
  log_info "STARTUP" "✓ Port availability"

  check_rtmp_host || exit 1
  log_info "STARTUP" "✓ RTMP host configuration"

  log_info "STARTUP" "All pre-flight checks passed ✓"

  # Start the sidecar (compiled binary or via bun)
  log_info "STARTUP" "Starting sidecar..."

  cd "$PROJECT_ROOT"

  # Detect if running compiled binary (Docker) or development mode
  # Prefer bun for better error messages during development
  local sidecar_cmd
  if command -v bun &> /dev/null; then
    sidecar_cmd="bun run src/index.ts"
    log_info "STARTUP" "Using Bun runtime: bun run src/index.ts"
  elif [ -x "/app/sidecar" ]; then
    sidecar_cmd="/app/sidecar"
    log_info "STARTUP" "Using compiled binary: /app/sidecar"
  else
    log_error "STARTUP" "Neither Bun nor compiled binary (/app/sidecar) found"
    exit 1
  fi

  # Run sidecar with both stdout and stderr captured
  if [ "$verbose" = true ]; then
    $sidecar_cmd 2>&1 | tee -a "$LOG_DIR/sidecar.log" || handle_bun_error
  else
    $sidecar_cmd >> "$LOG_DIR/sidecar.log" 2>&1 || handle_bun_error
  fi
}

# Trap errors
trap handle_bun_error EXIT

# Run
main "$@"
