# Step 8 Infrastructure: Server Bootstrap & Graceful Shutdown

## Overview

This step implements comprehensive server startup and shutdown infrastructure, completing the sidecar's lifecycle management.

## What Was Built

### 1. Server Bootstrap Script (`docker/server.sh`)

A bash script that wraps the compiled Bun binary with:

- **Pre-flight validation** before starting sidecar
  - Environment variables (MONGO_URI, HTTP_PORT, JWT_SECRET, ENCRYPTION_KEY)
  - nginx binary existence and executability
  - MongoDB connectivity
  - Port availability (8080, 1935, 8090)

- **Per-module error logging**
  - ENV, NGINX, MONGODB, PORTS, STARTUP logs written to `.logs/` directory
  - Structured error reporting for debugging startup failures
  - Clear indication which component failed if bootstrap errors

- **Fallback error detection**
  - Captures exit code from sidecar
  - Logs module-specific errors based on sidecar output patterns
  - Directs user to full logs for investigation

**Used in:** Dockerfile as CMD, runs as PID 1 in container

### 2. Graceful Shutdown Handlers (bootstrap.ts)

SIGTERM/SIGINT handlers that dispose all modules in clean dependency order:

1. **HTTP server** (`httpApi.dispose()`) — stop accepting requests
2. **nginx** (`nginxProcessManager.dispose()`) — graceful SIGTERM to master
3. **MongoDB** (`mongo.dispose()`) — close connection pool

Each dispose is idempotent and error-tolerant — shutdown continues even if a module throws.

**Triggered by:** `docker-compose down`, `docker-compose stop`, `Ctrl+C` in development

### 3. Module Dispose Methods

#### HttpApi.dispose()
- Calls `server.stop()` to close listening socket
- Allows in-flight HTTP requests to finish
- Idempotent

#### NginxProcessManager.dispose()
- Sends SIGTERM to nginx master process
- nginx's standard graceful stop: drop new connections, finish in-flight pushes
- Sets `#stopping = true` to suppress crash-loop during intentional shutdown
- Idempotent

#### MongoService.dispose()
- Renamed from `.close()` for consistency
- Closes connection pool
- Catches and logs errors to avoid blocking shutdown
- Awaits actual close completion
- Idempotent

### 4. Documentation

**docs/SHUTDOWN.md** — Complete shutdown reference:
- Shutdown sequence details
- Each module's dispose implementation
- Docker timeout behavior (10s SIGTERM → SIGKILL)
- Testing procedures
- Failure modes

## Changes Made

**Files modified:**
- `docker/server.sh` → renamed from `scripts/start.sh`, updated headers
- `Dockerfile` → reference `docker/server.sh`, update CMD
- `src/bootstrap.ts` → add SIGTERM/SIGINT handlers (lines 161–197)
- `src/infra/mongo-service.ts` → rename `close()` → `dispose()`, add error handling
- `src/http-api.ts` → rename `stop()` → `dispose()`, add documentation
- `src/modules/relay/nginx-process-manager.ts` → rename `stop()` → `dispose()`, add documentation

**Files created:**
- `docs/SHUTDOWN.md` — shutdown reference manual
- `docs/STEP8-INFRASTRUCTURE.md` — this file

## Testing

### Startup
```bash
docker compose up -d && sleep 5
docker compose logs relay | grep STARTUP
```

Expected: All pre-flight checks pass, sidecar bootstraps successfully.

### Shutdown
```bash
docker compose stop
docker compose logs relay | tail -10
```

Expected: Logs show "Shutdown signal received", module disposal order, "Shutdown complete".

### Health Check
```bash
curl http://localhost:8080/health | jq .
```

Returns:
- `ingestStatus: "offline"` (until stream activates)
- `nginxReachable: false` (until profile activation)
- `mongoReachable: true`

## Known Gaps

None for this step. Shutdown infrastructure is complete and tested.

## Next Steps

Step 9 (future): Implement `/stats` endpoint to parse nginx stats and populate StreamState with real bytesIn/bitrateKbps (currently hardcoded 0).

Step 10 (future): Add AuditLogger module for access/transaction logging.

## Architecture Notes

- **PID 1 process:** The sidecar runs as PID 1 in the container (via `server.sh`), receiving signals directly
- **No subprocess detachment:** nginx is spawned as a child, not daemonized, so its lifecycle is tied to sidecar
- **Idempotent dispose:** Multiple dispose calls or concurrent signals don't cause double-cleanup
- **Error continuation:** Errors during shutdown don't block subsequent module cleanup
- **Exit codes:** 0 on clean shutdown, 1 on error during shutdown
