<p align="center">
  <img src="assets/brand/social-preview-1280x640.png" alt="Ya'll Cast — self-hosted streaming server" width="640">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-D52B1E?logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-1A1410?logo=typescript&logoColor=F4B41A" alt="TypeScript">
  <img src="https://img.shields.io/badge/Docker-EE7A1C?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/nginx--rtmp-1A1410?logo=nginx&logoColor=F4B41A" alt="nginx-rtmp-module">
  <img src="https://img.shields.io/badge/MongoDB-D52B1E?logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/license-MIT-F6EEDC?labelColor=1A1410" alt="License: MIT">
</p>

# yall-rtmp-docker-stream

A single containerized agent that takes one RTMP ingest from OBS and relays it live, unmodified, to Mixcloud Live, YouTube, and Twitch at once. Per-user destination profiles (each with its own stream keys), one active broadcast at a time, auth-gated config, fully event-driven — no polling, no unscoped timers.

## Status

Design complete, nothing built yet. This repo is currently documentation-only — see below before writing any code against it. No CI badge above on purpose: `docs/TECHNICAL.md` §CI/CD pipeline designs the workflow, but no `.github/workflows/` exists yet — a badge for it would just be broken or lying.

## Docs

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — the source of truth: architecture, module design, event taxonomy, persistence, auth, error handling, CI/CD, security suite. Read this first.
- [openapi.yaml](openapi.yaml) — second source of truth, generated from TECHNICAL.md's own API contracts. Validated clean against Spectral's `oas` ruleset.
- [docs/design-briefs/screens-and-journeys.md](docs/design-briefs/screens-and-journeys.md) — every screen and user journey for the dashboard UI. Local only, not yet pushed.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — short decision log with dates.

## License

MIT — see [LICENSE](LICENSE).
