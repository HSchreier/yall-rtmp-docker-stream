<p align="center">
  <img src="assets/brand/social-preview-1280x640.png" alt="Ya'll Cast — self-hosted streaming server" width="640">
</p>

<p align="center">
  <img src="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/ci.yml/badge.svg?branch=staging" alt="CI">
  <img src="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/security.yml/badge.svg?branch=staging" alt="Security">
  <img src="https://img.shields.io/github/v/release/HSchreier/yall-rtmp-docker-stream?include_prereleases&label=release&color=D52B1E" alt="Latest release">
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

## Status — first unstable release ([v0.1.0-alpha.1](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1))

**The RTMP relay itself does not exist yet.** What's real: the control-plane app — auth, per-user destination profiles, activation, a working browser UI — verified end to end against a live Mongo, not just unit-tested. What's missing: `nginx-rtmp-module`, the actual relay logic, `StreamState`, live status. See the [release notes](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1) for the full honest breakdown, and `docs/TECHNICAL.md`'s "Open questions" for what's still unresolved.

## Install

```bash
git clone https://github.com/HSchreier/yall-rtmp-docker-stream.git
cd yall-rtmp-docker-stream
./scripts/install.sh
```

Checks for Bun and Docker (installs Bun automatically if missing; Docker needs a manual install from [docker.com](https://docs.docker.com/get-docker/) — a GUI install with a license to accept, not something to script blindly), generates `.env` with a real random `JWT_SECRET`, installs dependencies, starts Mongo. Safe to re-run — won't touch an existing `.env`.

```bash
bun run dev   # --watch, http://localhost:8080
```

First visit walks you through creating the administrator account — no separate seed step.

## Local dev (manual, if you'd rather not run the script)

```bash
docker compose up -d mongo
cp .env.example .env   # fill in JWT_SECRET
bun install
bun run dev             # --watch, http://localhost:8080
```

`bun run build` compiles to a standalone binary (`dist/sidecar`); `bun run start` runs it. `bun test` (unit, no external deps) / `bun run test:integration` (needs the Mongo above).

## Docs

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — the source of truth: architecture, module design, event taxonomy, persistence, auth, error handling, CI/CD, security suite. Read this first.
- [openapi.yaml](openapi.yaml) — second source of truth, generated from TECHNICAL.md's own API contracts. Kept in sync by `scripts/check-spec-sync.ts`, enforced in CI.
- [docs/design-briefs/screens-and-journeys.md](docs/design-briefs/screens-and-journeys.md) — every screen and user journey for the dashboard UI.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — short decision log with dates.

## CI/CD

Two workflows, both required on every PR into `staging` and on `staging → main`:

- **[CI](.github/workflows/ci.yml)** — spec sync, lint (Biome), typecheck, unit tests, integration tests (against a real Mongo service container), compile (`bun build --compile`). No Docker-build job yet — there's no `Dockerfile` until the nginx-facing modules exist; a job that always fails because its input doesn't exist would be a permanent red X with no signal.
- **[Security](.github/workflows/security.yml)** — gitleaks (secret scan, full history), Semgrep (project-specific rules in `.semgrep/security.yml` — `updatedBy`/`registeredBy`/`activatedBy` must never come from a request body, not generic OWASP noise), Spectral (`.spectral.yaml` — every `openapi.yaml` operation must declare a `security` block).

Branch flow: `feature/* → staging → main`, `staging` always green, `main` receives only deliberate merges. See `docs/TECHNICAL.md` §CI/CD pipeline for the full reasoning, including what these checks *can't* catch (the two conditional-auth cases documented in `openapi.yaml`'s own `info.description`).

## License

MIT — see [LICENSE](LICENSE).
