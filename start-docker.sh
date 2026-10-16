#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}➜${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }

case "${1:-start}" in
  start)
    log_info "Starting Docker containers (MongoDB)..."
    docker-compose up -d mongo
    sleep 2
    if docker-compose ps mongo | grep -q "Up"; then
      log_info "MongoDB running ✓"
    else
      log_error "MongoDB failed to start"
      exit 1
    fi
    ;;
  stop)
    log_info "Stopping Docker containers..."
    docker-compose down
    log_info "Docker stopped"
    ;;
  restart)
    docker-compose down
    sleep 1
    docker-compose up -d mongo
    sleep 2
    if docker-compose ps mongo | grep -q "Up"; then
      log_info "MongoDB restarted ✓"
    else
      log_error "MongoDB failed to start"
      exit 1
    fi
    ;;
  status)
    echo ""
    log_info "Docker container status:"
    docker-compose ps
    echo ""
    ;;
  logs)
    log_info "Following MongoDB logs..."
    docker-compose logs -f mongo
    ;;
  *)
    cat << EOF
${GREEN}Docker Container Manager${NC}

Usage: ./start-docker.sh [command]

Commands:
  start              Start MongoDB container (default)
  stop               Stop all containers
  restart            Restart MongoDB
  status             Show container status
  logs               Follow MongoDB logs

Note: Run this once at the start of your dev session.
Then use ./server.sh to manage backend + frontend.
EOF
    ;;
esac
