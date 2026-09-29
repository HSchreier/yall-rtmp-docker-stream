# Architecture

## Confirmed

- Single RTMP ingest → fan-out to multiple RTMP destinations (restreamer).

## Open decisions

### Control interface

- **Static config (YAML/env)** — destinations set at container start, restart to change.
- **REST/HTTP API** — add/remove destinations at runtime without restarting.

### Runtime approach

- **ffmpeg tee muxer** — one ffmpeg process tees the incoming stream to N RTMP outputs. Simple, battle-tested, low overhead per extra output since no re-encode is needed (copy codec).
- **nginx-rtmp-module** — nginx ingests RTMP and uses `push` directives to relay to multiple destinations. Built-in stats/monitoring, but a heavier base image and less flexible for dynamic destination changes.

Decide both before writing the Dockerfile / entrypoint.
