#!/bin/bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$PROJECT_ROOT/.devserver.pids"
LOG_DIR="$PROJECT_ROOT/logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

mkdir -p "$LOG_DIR"

# Helper functions
log_info() {
  echo -e "${GREEN}➜${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

save_pid() {
  local name=$1
  local pid=$2
  echo "$name:$pid" >> "$PID_FILE"
}

get_pid() {
  local name=$1
  grep "^$name:" "$PID_FILE" 2>/dev/null | cut -d: -f2
}

cleanup_pids() {
  > "$PID_FILE"
}

# Commands
start_backend() {
  log_info "Starting backend (port 8888)..."
  cd "$PROJECT_ROOT"
  bun run dev > "$LOG_DIR/backend.log" 2>&1 &
  local pid=$!
  save_pid "backend" $pid
  log_info "Backend started (PID: $pid)"
  sleep 2
  if kill -0 $pid 2>/dev/null; then
    log_info "Backend is running ✓"
  else
    log_error "Backend failed to start — check $LOG_DIR/backend.log"
    exit 1
  fi
}

start_frontend() {
  log_info "Starting frontend (port 5173)..."
  cd "$PROJECT_ROOT/frontend"
  bun run dev > "$LOG_DIR/frontend.log" 2>&1 &
  local pid=$!
  save_pid "frontend" $pid
  log_info "Frontend started (PID: $pid)"
  sleep 2
  if kill -0 $pid 2>/dev/null; then
    log_info "Frontend is running ✓"
  else
    log_error "Frontend failed to start — check $LOG_DIR/frontend.log"
    exit 1
  fi
}

start_all() {
  cleanup_pids
  start_backend
  start_frontend
  echo ""
  log_info "All services running:"
  log_info "  Backend:  http://192.168.188.29:8888"
  log_info "  Frontend: http://192.168.188.29:5173"
  echo ""
  log_info "Tail logs with: start.sh logs [backend|frontend]"
}

stop_all() {
  if [[ ! -f "$PID_FILE" ]]; then
    log_warn "No running services found"
    return 0
  fi

  while IFS=: read -r name pid; do
    if [[ -z "$pid" ]]; then continue; fi
    if kill -0 $pid 2>/dev/null; then
      log_info "Killing $name (PID: $pid)..."
      kill $pid 2>/dev/null || true
    fi
  done < "$PID_FILE"

  cleanup_pids
  log_info "All services stopped"
}

restart_all() {
  stop_all
  sleep 1
  start_all
}

status() {
  if [[ ! -f "$PID_FILE" ]]; then
    log_warn "No services running"
    return 0
  fi

  echo ""
  log_info "Service status:"
  while IFS=: read -r name pid; do
    if [[ -z "$pid" ]]; then continue; fi
    if kill -0 $pid 2>/dev/null; then
      echo -e "  ${GREEN}●${NC} $name (PID: $pid)"
    else
      echo -e "  ${RED}●${NC} $name (PID: $pid) — dead"
    fi
  done < "$PID_FILE"
  echo ""
}

logs() {
  local service=$1
  if [[ -z "$service" ]]; then
    service="all"
  fi

  case $service in
    backend)
      log_info "Tailing backend logs (Ctrl+C to exit)..."
      tail -f "$LOG_DIR/backend.log"
      ;;
    frontend)
      log_info "Tailing frontend logs (Ctrl+C to exit)..."
      tail -f "$LOG_DIR/frontend.log"
      ;;
    all)
      log_info "Tailing all logs (Ctrl+C to exit)..."
      tail -f "$LOG_DIR"/*.log
      ;;
    *)
      log_error "Unknown service: $service"
      exit 1
      ;;
  esac
}

# Main
case "${1:-start}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    restart_all
    ;;
  status)
    status
    ;;
  logs)
    logs "$2"
    ;;
  *)
    cat << EOF
Usage: $0 [command] [options]

Commands:
  start              Start all services (default)
  stop               Stop all services
  restart            Restart all services
  status             Show service status
  logs [service]     Tail logs (backend, frontend, or all)
  -h, --help         Show this help

Examples:
  $0 start
  $0 logs frontend
  $0 restart
EOF
    exit 0
    ;;
esac
