# Graceful Shutdown

The sidecar implements graceful shutdown through SIGTERM/SIGINT handlers that dispose all modules in reverse-dependency order. This ensures clean shutdown during container stop or development mode termination.

## Shutdown Sequence

When Docker sends SIGTERM (via `docker-compose down`), the process:

1. **Log signal** → logs "Shutdown signal received"
2. **Stop HTTP server** → `httpApi.dispose()` closes the listening socket, waits for in-flight requests
3. **Stop nginx** → `nginxProcessManager.dispose()` sends SIGTERM to nginx master process
4. **Close database** → `mongo.dispose()` closes MongoDB connection pool
5. **Exit cleanly** → `process.exit(0)` after all modules disposed

Each module's `dispose()` is **idempotent** — safe to call multiple times, won't throw, and logs errors rather than crashing the shutdown sequence.

## Module Dispose Methods

### HttpApi.dispose()

```typescript
dispose(): void {
  if (!this.#server) return;
  this.#server.stop();
}
```

- Closes the listening socket (stops accepting new HTTP requests)
- Bun's `server.stop()` allows in-flight requests to finish
- Idempotent (calling twice is safe)
- No async operations

**Called during shutdown:** Stops accepting new requests immediately.

### NginxProcessManager.dispose()

```typescript
dispose(): void {
  if (!this.#child) return;
  this.#stopping = true;
  this.#child.kill("SIGTERM");
}
```

- Sends SIGTERM to the nginx master process (graceful reload/stop)
- nginx's standard handler: stop accepting new RTMP connections, wait for in-flight connections to finish
- Sets `#stopping = true` to suppress crash-loop logic during intentional shutdown
- Idempotent (if nginx not running, returns immediately)
- Synchronous (doesn't wait for nginx to actually exit)

**Called during shutdown:** nginx has ~10s to finish in-flight RTMP pushes before Docker force-kills the container.

### MongoService.dispose()

```typescript
async dispose(): Promise<void> {
  if (!this.#client) return;
  try {
    await this.#client.close();
  } catch (err) {
    this.logger.error(
      { err: err.message },
      "MongoService.dispose: close threw (continuing shutdown)"
    );
  }
}
```

- Closes the MongoDB connection pool
- Awaits actual close completion
- Catches and logs errors to avoid blocking shutdown
- Idempotent (client guard prevents multiple closes)

**Called during shutdown:** Releases connection pool, allowing graceful disconnect from Mongo.

## Shutdown Handler

Located in [src/bootstrap.ts](../src/bootstrap.ts), line 161–197:

```typescript
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
```

**Triggers:**
- `docker-compose down` → sends SIGTERM after 10s timeout
- `docker-compose stop` → sends SIGTERM after 10s timeout
- `Ctrl+C` in development → sends SIGINT

**Debouncing:** A `shutdownInProgress` flag prevents multiple signals from running the shutdown sequence twice.

**Logging:** Each step logs to the sidecar's own logger (appears in `docker compose logs relay`).

## Docker Behavior

```bash
docker compose down         # Sends SIGTERM, waits 10s, then SIGKILL
docker compose stop         # Sends SIGTERM, waits 10s, then SIGKILL
docker-compose.yml healthcheck  # Continues polling during shutdown
```

The `healthcheck` in `docker-compose.yml` will report the container as unhealthy during shutdown (HTTP server is down), which is expected.

## Development Mode

In development (running the sidecar directly with `bun run`):

```bash
Ctrl+C  # Sends SIGINT to the process
```

The shutdown sequence runs the same way as SIGTERM.

## Server Bootstrap Script

The shell script [docker/server.sh](../docker/server.sh) handles:

- **Startup phase:** Pre-flight validation before spawning sidecar
- **Shutdown phase:** Logs module disposal (but doesn't call dispose directly — that happens in bootstrap.ts)

The script itself doesn't need to intercept SIGTERM; it spawns the sidecar as PID 1 (via `exec` in production), so the sidecar receives signals directly.

## Testing Shutdown

```bash
# Start services
docker compose up -d

# Let it run for a few seconds
sleep 5

# Stop cleanly (SIGTERM)
docker compose stop

# Check logs for shutdown sequence
docker compose logs relay | tail -20
```

Expected output includes:
```
Shutdown signal received — disposing modules
Stopping HTTP server
Stopping nginx
Closing MongoDB
Shutdown complete
```

## Failure Modes

1. **nginx doesn't stop in time** → Docker force-kills after 10s, in-flight RTMP pushes may be lost
2. **MongoDB takes too long** → Docker force-kills after 10s, may lose uncommitted transactions
3. **Error during dispose** → Logged, shutdown continues to next module

None of these block shutdown — the process always exits after all modules are disposed or an error is caught.
