# Step 8: Real End-to-End Test with Docker & FFmpeg

## Goal

Answer the critical open question empirically:

**Does `nginx -s reload` (sent by `NginxProcessManager` on a config change) cleanly repoint an already-live RTMP push without dropping/stalling the broadcast?**

This is the final gate on whether the relay architecture actually works end-to-end, and whether the reactive-buffer idea (future enhancement mentioned in docs/TECHNICAL.md) is even worth revisiting.

## Prerequisites

- `.env` file with `JWT_SECRET` and `ENCRYPTION_KEY` already filled in
- Docker Engine running
- `ffmpeg` installed on the host (test stream source)
- `curl` for API calls (setup + triggering profile change)

## Setup & Execution

### 1. Build the Docker Image

```bash
docker build -t yall-rtmp-relay:latest .
```

Verify the image builds successfully with no errors. The multi-stage build should:
- Compile nginx + `nginx-rtmp-module` (GCC toolchain, stage 1)
- Run `nginx -t` self-test on the real template with dummy values (build-time gate)
- Compile the Bun sidecar to a standalone binary (stage 2)
- Copy both into a minimal runtime image (stage 3)

### 2. Start the Services

```bash
docker compose up
```

Wait for both services to be healthy (the relay service includes a healthcheck that polls `/health`). You should see:
- Mongo starting on `localhost:27117`
- Relay starting, sidecar connecting to Mongo, nginx coming up inside the container

If the relay service exits immediately, check the logs:
```bash
docker compose logs relay
```

Look for errors in nginx startup or sidecar initialization.

### 3. Register a User & Create a Destination Profile

First, register the admin account:
```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.local",
    "password": "test-password-123"
  }'
```

Login to get a JWT:
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "admin@test.local",
    "password": "test-password-123"
  }'
```

Extract the bearer token from the response (in the `token` field).

Set a destination profile (e.g., Twitch with a dummy key):
```bash
curl -X PUT http://localhost:8080/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "twitch": {
      "enabled": true,
      "streamKey": "live_12345678901234567890"
    },
    "mixcloud": {"enabled": false},
    "youtube": {"enabled": false},
    "bufferProfile": "mobile"
  }'
```

### 4. Activate the Profile

```bash
curl -X POST http://localhost:8080/profile/activate \
  -H "Authorization: Bearer <TOKEN>"
```

At this point:
- nginx inside the relay container has re-rendered its config with your stream key
- nginx is ready to accept an RTMP publish on `rtmp://localhost:1935/ingest/<ingest-key>`
- The ingest key is auto-generated; retrieve it from the profile (or check the logs)

### 5. Push a Test Stream with FFmpeg

Start a test stream (10 seconds, synthetic video + audio):
```bash
ffmpeg \
  -f lavfi -i testsrc=s=320x240:d=10 \
  -f lavfi -i sine=f=1000:d=10 \
  -c:v libx264 -preset veryfast -b:v 1000k \
  -c:a aac -b:a 128k \
  -rtmp_live live \
  -flvflags no_duration_filesize \
  rtmp://localhost:1935/ingest/<INGEST_KEY>
```

The stream should start publishing. You'll see:
- `StreamStarted` event emitted by `IngestEventReceiver`
- `StreamOrchestrator` creates submodules (stats session, idle detector)
- Stats session starts polling (1-second ticks)
- Idle detector subscribed and tracking bytesIn

### 6. Trigger a Profile Change While Streaming

While the ffmpeg stream is still live (you have ~5-10 seconds), make a profile change that will force nginx to reload:
```bash
curl -X PUT http://localhost:8080/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "twitch": {
      "enabled": true,
      "streamKey": "live_99999999999999999999"
    },
    "mixcloud": {"enabled": false},
    "youtube": {"enabled": false},
    "bufferProfile": "stable"
  }'
```

This triggers:
- `DestinationCredentialsUpdated` event
- `NginxProcessManager` detects active profile and calls `reload()` (sends `SIGHUP` to nginx)
- nginx re-reads config, spins up new workers, lets old ones finish in-flight connections

### 7. Verify Stream Continuity

The key observation:
- **Expected**: ffmpeg's stream continues without interruption, reaching the end of the 10-second test video without warnings or errors
- **Failure mode 1**: ffmpeg reports connection lost / reconnecting (nginx dropped the push connection)
- **Failure mode 2**: ffmpeg hangs (nginx reload deadlocked or stalled the push)
- **Failure mode 3**: ffmpeg reports data corruption (nginx reload mangled the stream mid-frame)

Watch the ffmpeg output while the curl command above completes. If the stream keeps flowing and finishes cleanly, the reload worked.

## What to Check in Logs

### Relay Service Logs
```bash
docker compose logs relay
```

Look for:
- `ActiveProfileChanged` or `DestinationCredentialsUpdated` event processed
- `NginxProcessManager` reloading (SIGHUP signal sent)
- No `nginx.crashed` events
- No `EventBus listener threw` errors during stream events

### Browser Console / API Response
If you can access the API while streaming:
```bash
curl http://localhost:8080/stats
```

Should return:
- `status`: "live"
- `streamKey`: your ingest key
- `bytesIn`: non-zero and increasing
- `bitrateKbps`: calculated from the moving average
- `startedAt`: stream start timestamp
- `lastEventAt`: recent timestamp (the last `StreamStatUpdated` tick)

## Conclusion

If the ffmpeg stream finishes cleanly after a profile change and reload, the answer is **yes** — nginx reload works seamlessly during active broadcasts.

If it fails, the logs will show whether it's a connection drop, a stall, or a data corruption issue, pointing to the root cause (buffering exhaustion, signal handling, race condition, etc.).

## Future Work

If this test passes: the reactive-buffer enhancement mentioned in `docs/TECHNICAL.md` becomes viable, since we know nginx reload preserves active connections.

If it fails: we have a concrete test case for debugging, and the reactive-buffer idea stays on the "investigate later" shelf.

## Cleanup

```bash
docker compose down
```

Removes the containers but keeps the `mongo-data` volume. To reset Mongo:
```bash
docker volume rm <project>_mongo-data
```

## Notes

- The `StreamStatsSession` timer currently emits placeholder stats (bytesIn always 0). Once the real `/stat` endpoint parsing lands, you'll see live byte counters, which makes idle detection actually meaningful.
- The test is manual because it needs real-time observation of ffmpeg's behavior; no automated check can verify "smooth continuation" as well as human eyes on the output.
- If you want to test multiple streams or scenarios, repeat from step 3 (register a different user) or step 4 (different profile/buffer preset) without rebuilding the image.
