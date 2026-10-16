#!/bin/bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$PROJECT_ROOT/.server.pids"
LOG_DIR="$PROJECT_ROOT/logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log_info() { echo -e "${GREEN}➜${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_debug() { echo -e "${BLUE}→${NC} $1"; }

init_pids() { > "$PID_FILE"; }
save_pid() { echo "$1:$2" >> "$PID_FILE"; }
get_pid() { grep "^$1:" "$PID_FILE" 2>/dev/null | cut -d: -f2 || echo ""; }
is_running() { [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null; }

start_backend() {
  log_info "Starting backend (port 8888)..."
  cd "$PROJECT_ROOT"
  bun run dev > "$LOG_DIR/backend.log" 2>&1 &
  local pid=$!
  save_pid "backend" $pid
  sleep 2
  if is_running $pid; then
    log_info "Backend running (PID: $pid) ✓"
  else
    log_error "Backend failed — check logs"
    tail -20 "$LOG_DIR/backend.log"
    exit 1
  fi
}

start_frontend() {
  log_info "Starting frontend (port 5173)..."
  cd "$PROJECT_ROOT/frontend"
  bun run dev > "$LOG_DIR/frontend.log" 2>&1 &
  local pid=$!
  save_pid "frontend" $pid
  sleep 2
  if is_running $pid; then
    log_info "Frontend running (PID: $pid) ✓"
  else
    log_error "Frontend failed — check logs"
    tail -20 "$LOG_DIR/frontend.log"
    exit 1
  fi
}

start() {
  init_pids
  start_backend
  start_frontend
  echo ""
  log_info "All services running"
  log_info "  Backend:  http://192.168.188.29:8888"
  log_info "  Frontend: http://192.168.188.29:5173"
}

stop() {
  if [[ ! -f "$PID_FILE" ]]; then
    log_warn "No services running"
    return 0
  fi

  while IFS=: read -r name pid; do
    [[ -z "$pid" ]] && continue
    if is_running $pid; then
      log_info "Stopping $name (PID: $pid)..."
      kill $pid 2>/dev/null || true
    fi
  done < "$PID_FILE"

  rm -f "$PID_FILE"
  log_info "All services stopped"
}

restart() {
  stop
  sleep 1
  start
}

kill_all() {
  log_warn "Force killing all bun processes..."
  pkill -f "bun run dev" || true
  pkill -f "bun" || true
  rm -f "$PID_FILE"
  log_info "Killed"
}

shutdown() {
  log_warn "Shutting down all services..."
  stop
  log_info "Cleaning up logs and PIDs..."
  rm -f "$PID_FILE"
  rm -f "$LOG_DIR"/*.log
  log_info "Shutdown complete"
}

status() {
  [[ ! -f "$PID_FILE" ]] && { log_warn "No services running"; return; }
  echo ""
  log_info "Service status:"
  while IFS=: read -r name pid; do
    [[ -z "$pid" ]] && continue
    if is_running $pid; then
      echo -e "  ${GREEN}●${NC} $name (PID: $pid)"
    else
      echo -e "  ${RED}●${NC} $name (PID: $pid) — dead"
    fi
  done < "$PID_FILE"
  echo ""
}

debug() {
  local service="${1:-all}"
  case $service in
    backend)
      log_debug "Tailing backend logs..."
      tail -f "$LOG_DIR/backend.log"
      ;;
    frontend)
      log_debug "Tailing frontend logs..."
      tail -f "$LOG_DIR/frontend.log"
      ;;
    all)
      log_debug "Tailing all logs (Ctrl+C to exit)..."
      tail -f "$LOG_DIR"/*.log 2>/dev/null || echo "No logs yet"
      ;;
    *)
      log_error "Unknown service: $service"
      exit 1
      ;;
  esac
}

open_urls() {
  log_info "Opening URLs..."
  sleep 1
  open "http://192.168.188.29:5173" || true
  open "http://192.168.188.29:8888" || true
}

tail_logs() {
  local service="${1:-all}"
  case $service in
    backend)
      tail -20 "$LOG_DIR/backend.log"
      ;;
    frontend)
      tail -20 "$LOG_DIR/frontend.log"
      ;;
    all)
      echo "=== Backend ==="
      tail -10 "$LOG_DIR/backend.log"
      echo ""
      echo "=== Frontend ==="
      tail -10 "$LOG_DIR/frontend.log"
      ;;
    *)
      log_error "Unknown service: $service"
      exit 1
      ;;
  esac
}

case "${1:-start}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    restart
    ;;
  status)
    status
    ;;
  debug)
    debug "$2"
    ;;
  logs)
    tail_logs "$2"
    ;;
  open)
    open_urls
    ;;
  kill)
    kill_all
    ;;
  shutdown)
    shutdown
    ;;
  backend)
    init_pids
    start_backend
    tail -f "$LOG_DIR/backend.log"
    ;;
  frontend)
    init_pids
    start_frontend
    tail -f "$LOG_DIR/frontend.log"
    ;;
  *)
    cat << EOF
${GREEN}yall-rtmp dev server${NC}

Usage: ./server.sh [command]

Manages: Backend (Bun) + Frontend (Vite)
Requires: Docker containers running (use ./start-docker.sh first)

Commands:
  start              Start backend + frontend (default)
  stop               Stop all services
  restart            Restart all services
  status             Show service status
  debug [service]    Tail logs (backend, frontend, all)
  logs [service]     Show last 20 lines (backend, frontend, all)
  backend            Start backend only + follow logs
  frontend           Start frontend only + follow logs
  open               Open URLs in browser
  kill               Force kill all bun processes
  shutdown           Stop services + clean up logs & PIDs

Examples:
  ./start-docker.sh start    # First: start Docker containers
  ./server.sh start          # Then: start backend + frontend
  ./server.sh debug frontend
  ./server.sh restart
EOF
    ;;
esac
