# yall-rtmp-docker-stream

Containerized RTMP multi-stream agent: receives a single RTMP ingest (e.g. from OBS) and relays it live to multiple RTMP destinations (Twitch, YouTube, Facebook, custom endpoints, etc.) simultaneously.

## Status

Early scaffold. Architecture decisions below are still open — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Confirmed

- **Flow:** single RTMP ingest → fan-out to N RTMP destinations (restreamer, not a puller).

## Open decisions

- Control interface: static config (YAML/env) vs. runtime REST API for adding/removing destinations.
- Runtime: ffmpeg tee-based relay vs. nginx-rtmp-module push directives.

## License

MIT — see [LICENSE](LICENSE).
