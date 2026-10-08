<p align="center">
  <img src="assets/brand/social-preview-1280x640.png" alt="Ya'll Cast — self-hosted streaming server" width="640">
</p>

<p align="center">
  <a href="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/ci.yml"><img src="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/ci.yml/badge.svg?branch=staging" alt="CI"></a>
  <a href="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/security.yml"><img src="https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/security.yml/badge.svg?branch=staging" alt="Security"></a>
  <a href="https://github.com/HSchreier/yall-rtmp-docker-stream/releases"><img src="https://img.shields.io/github/v/release/HSchreier/yall-rtmp-docker-stream?include_prereleases&label=release&color=D52B1E" alt="Latest release"></a>
  <a href="https://github.com/HSchreier/yall-rtmp-docker-stream/commits/staging"><img src="https://img.shields.io/github/last-commit/HSchreier/yall-rtmp-docker-stream/staging?label=last%20commit&color=F4B41A&labelColor=1A1410" alt="Last commit"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-beta-F4B41A?labelColor=1A1410" alt="Status: Beta">
  <a href="https://github.com/HSchreier/yall-rtmp-docker-stream/pulls"><img src="https://img.shields.io/badge/PRs-welcome-D52B1E?labelColor=1A1410" alt="PRs Welcome"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F6EEDC?labelColor=1A1410" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-D52B1E?logo=bun&logoColor=white" alt="Bun"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-1A1410?logo=typescript&logoColor=F4B41A" alt="TypeScript"></a>
  <a href="https://www.docker.com"><img src="https://img.shields.io/badge/Docker-EE7A1C?logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://github.com/arut/nginx-rtmp-module"><img src="https://img.shields.io/badge/nginx--rtmp-1A1410?logo=nginx&logoColor=F4B41A" alt="nginx-rtmp-module"></a>
  <a href="https://www.mongodb.com"><img src="https://img.shields.io/badge/MongoDB-D52B1E?logo=mongodb&logoColor=white" alt="MongoDB"></a>
</p>

# Ya'll Cast

A single containerized agent that takes one RTMP ingest from OBS and relays it live, unmodified, to Mixcloud Live, YouTube, and Twitch at once. Per-user destination profiles (each with its own stream keys), one active broadcast at a time, auth-gated config, fully event-driven — no polling, no unscoped timers.

## Status — beta, relay build in progress

**[v0.1.0-alpha.1](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1)** is the last tagged release; the RTMP relay itself has landed since on [`feature/rtmp-relay-dockerfile`](https://github.com/HSchreier/yall-rtmp-docker-stream/pull/5) (steps 1–4 of an 8-step build order, each independently verified end-to-end in a real running container, not just unit-tested) and is awaiting review before merge.

| Built and verified | Not built yet |
|---|---|
| Auth (bootstrap admin, register, login) | `StreamState` — live "is it actually streaming" status |
| Per-user destination profiles (Mixcloud/YouTube/Twitch keys) | `StreamOrchestrator` + stats/idle-detection submodules |
| One-active-profile activation, incl. admin-activate-for-anyone | Real-time status via SSE (`/events` is a placeholder) |
| Full browser dashboard UI (not just a JSON API) | `docker-compose.yml`'s `relay` service (Dockerfile exists, not wired into compose yet) |
| Admin user-management table, incl. self-service account editing | Real end-to-end ffmpeg test — the one that proves an nginx reload doesn't drop an already-live push |
| **`Dockerfile`** — nginx + `nginx-rtmp-module` compiled in, multi-stage, build-time config self-test | Docker-build job in CI (the image builds and runs; nothing in CI builds it on every PR yet) |
| **`NginxConfigRenderer`** — per-profile `nginx.conf` templating, buffer presets | |
| **`IngestEventReceiver` + `RelayRouter`** — nginx's `on_publish`/`on_publish_done` webhooks, loopback-only | |
| **`NginxProcessManager`** — spawns/supervises/crash-loops the real nginx process, verified against a real compiled image (register → activate a profile → confirm nginx comes up, `/stat` reporting real RTMP traffic) | |

See the [release notes](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1) and [`docs/TECHNICAL.md`](docs/TECHNICAL.md)'s "Build order" (§RTMP relay) and "Open questions" sections for the full, current breakdown.

## Quick start

Requirements: **[Docker](https://docs.docker.com/get-docker/)** (running), and either **[Bun](https://bun.sh)** already installed or let the script install it for you. macOS or Linux.

```bash
git clone https://github.com/HSchreier/yall-rtmp-docker-stream.git
cd yall-rtmp-docker-stream
./scripts/install.sh
```

What that does, in order:
1. Checks for Bun — installs it via the official installer if missing.
2. Checks Docker is installed and running — stops with a clear message if not (this one's on you, it needs a GUI install/license).
3. Copies `.env.example` → `.env` and fills in freshly generated `JWT_SECRET`/`ENCRYPTION_KEY` values. Safe to re-run — won't touch an existing `.env`.
4. Runs `bun install`.
5. Starts Mongo (`docker compose up -d mongo`) on `localhost:27117`.

Then start the app:

```bash
bun run dev
```

Open **http://localhost:8080** — first visit walks you through creating the administrator account. No separate seed step, no CLI command to remember.

## Cloud Deployment (Production)

Want to run this on a real server? **See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** for:
- **Cloud provider comparison** — Hetzner ($4.50/mo), DigitalOcean ($12/mo), AWS (variable)
- **Step-by-step setup** — Hetzner, DigitalOcean, and AWS
- **Cost breakdown** — what you'll actually pay
- **Production hardening** — firewall, SSL/TLS, monitoring

**TL;DR:** Cheapest option is **Hetzner CPX11** at $4.50/month. Takes ~10 minutes to deploy.

## Manual setup (if you'd rather not run the script)

```bash
docker compose up -d mongo        # Mongo 7, host-mapped to localhost:27117
cp .env.example .env              # then fill in JWT_SECRET and ENCRYPTION_KEY yourself, e.g.:
                                   #   openssl rand -hex 32
bun install
bun run dev                       # --watch, http://localhost:8080
```

## Environment variables

Set in `.env` (never committed — `.env.example` is the template). `ConfigService` validates all of these at startup and fails fast, listing every missing var together, if any are absent.

| Variable | Required | What it's for |
|---|---|---|
| `MONGO_URI` | yes | Defaults to `mongodb://localhost:27117/yallcast-dev` — the sidecar runs on your host via `bun run dev`, not inside docker-compose, so it talks to Mongo's host-mapped port, not `mongo:27017`. |
| `JWT_SECRET` | yes | Signs session tokens. `install.sh` generates one with `openssl rand -hex 32`; do the same if setting up by hand. |
| `ENCRYPTION_KEY` | yes | 64 hex chars (32 bytes) for AES-256-GCM — encrypts destination stream keys at rest. A different key from `JWT_SECRET` on purpose (signing and at-rest encryption are different cryptographic purposes). `install.sh` generates this one too; by hand it's the same `openssl rand -hex 32`. |
| `HTTP_PORT` | no (defaults to `8080`) | Where the dashboard/API listens. |
| `DEBUG` | no (defaults to unset) | Set to `1` or `true` to enable debug-level logging with pretty-printed output. Defaults to info-level with structured JSON output. See [Debugging](#debugging) below. |
| `LOG_LEVEL` | no (defaults to `debug` if `DEBUG=1`, else `info`) | Fine-grained log level control: `debug`, `info`, `warn`, `error`, `fatal`. Independent of `DEBUG` — can use JSON output at debug level, or pretty-print at warn level. |

Destination stream keys (Mixcloud/YouTube/Twitch) are **not** env vars — they live in Mongo, per user, set through the dashboard itself after you log in.

## Available scripts

### Development commands

Run these from the repo root:

| Command | What it does |
|---|---|
| `bun run dev` | Starts the app with `--watch` (auto-restarts on `src/**/*.ts` changes — **not** on `src/static/*` edits, see [Working on the frontend](#working-on-the-frontend) below). |
| `bun run build` | Compiles to a standalone binary at `dist/sidecar` via `bun build --compile`. |
| `bun run start` | Runs the compiled binary (`./dist/sidecar`). |
| `bun run lint` | Biome check on `src/`, `scripts/`, `tests/`. |
| `bun run lint:fix` | Same, but applies safe + unsafe auto-fixes. |
| `bun run typecheck` | `tsc --noEmit`, strict mode. |
| `bun run test` | Unit tests (`tests/unit/`) — no external services needed. |
| `bun run test:integration` | Integration tests (`tests/integration/`) — needs the Mongo container running (`docker compose up -d mongo`). |
| `bun run check:spec-sync` | Verifies `openapi.yaml` and `docs/TECHNICAL.md` haven't drifted apart. Runs in CI on every push. |

### Shell scripts

| Script | What it does |
|---|---|
| `./scripts/install.sh` | **One-shot local setup** — checks for Bun (installs if missing), verifies Docker is running, generates `.env` with secrets, runs `bun install`, starts Mongo container. Safe to re-run. |
| `./docker/server.sh` | **Container startup & shutdown** — runs inside the Docker container as PID 1 (via `Dockerfile` CMD). Performs pre-flight validation (env vars, nginx binary, ports, MongoDB connectivity), spawns the compiled sidecar binary, and handles graceful SIGTERM/SIGINT shutdown (see [Server startup and shutdown](#server-startup-and-shutdown) below). |
| `./scripts/test-local.sh` | **Local CI mirror** — runs all GitHub Actions checks locally before pushing (Biome lint, TypeScript check, gitleaks, spec sync, unit tests). **Blocks push if tests fail** via pre-push git hook. |

## Testing before push

**Always run local tests before pushing.** This catches formatting, type, and spec-sync errors locally instead of waiting for GitHub Actions:

```bash
# Manual run (useful during development)
./scripts/test-local.sh

# Automatic (blocks push if tests fail)
git push    # Pre-push hook runs all checks automatically
```

The local test suite mirrors GitHub Actions exactly:
- ✅ Biome lint + format check
- ✅ TypeScript type check (strict mode)
- ✅ Gitleaks secret scan
- ✅ Spec sync check (openapi.yaml ↔ TECHNICAL.md)
- ✅ Unit tests

**Pre-push hook installed:** Push is blocked if any test fails. Fix the issue locally, then `git push` again.

## Working on the frontend

The dashboard (`src/static/*.html`, `app.js`, `app.css`) is served as static files, read into memory **once** at boot — it is **not** in Bun's `--watch` dependency graph. If you edit anything under `src/static/`, you need to restart the dev server for the change to show up:

```bash
# Ctrl+C the running `bun run dev`, then:
bun run dev
```

Editing `src/**/*.ts` (routes, services, repositories) does auto-restart via `--watch`.

## Server startup and shutdown

### Docker deployment (`docker/server.sh`)

When running inside Docker (via `docker compose up`), the sidecar is started by `docker/server.sh`, which:

**Startup phase:**
1. Validates environment variables (MONGO_URI, HTTP_PORT, JWT_SECRET, ENCRYPTION_KEY)
2. Checks nginx binary exists and is executable
3. Tests MongoDB connectivity
4. Verifies ports 8080, 1935, 8090 are available
5. Logs all checks to `.logs/` directory with per-module error logging
6. Spawns the compiled Bun sidecar binary as PID 1

**Shutdown phase** (triggered by `docker compose down` / `docker compose stop`):
1. Receives SIGTERM or SIGINT signal
2. Stops HTTP server (closes listening socket, allows in-flight requests to finish)
3. Stops nginx (sends graceful SIGTERM to nginx master process)
4. Closes MongoDB connection pool
5. Exits cleanly (exit code 0)

Each shutdown step is **idempotent** (safe to call multiple times) and **error-tolerant** (errors are logged, shutdown continues).

**Usage:**
```bash
docker compose up -d                 # starts the relay container
docker compose stop                  # graceful shutdown (SIGTERM)
docker compose down                  # stop + remove containers
docker compose logs relay            # see startup/shutdown logs
```

See [`docs/SHUTDOWN.md`](docs/SHUTDOWN.md) for complete shutdown reference and implementation details.

### Local development

When running `bun run dev` on your host:
- The sidecar runs directly (not via `docker/server.sh`)
- `Ctrl+C` sends SIGINT → graceful shutdown
- Pre-flight validation still runs (same code path as Docker)

The nginx instance lives inside the `docker-compose.yml` relay service only — during local development, nginx is not started locally (the relay Dockerfile is not used).

## Project layout

```
src/
  bootstrap.ts               composition root — the only place that wires everything together
  index.ts                   entrypoint
  http-api.ts                Bun.serve-based HTTP router (hand-rolled, no framework)
  infra/                     cross-cutting, imported by any module, never the reverse
    event-bus.ts               typed EventBus — all cross-module side effects go through this
    events.ts                  the full EventMap (every event this app can emit)
    errors.ts                  typed error hierarchy (ValidationError, AuthError, ...)
    logger.ts                  Pino wrapper with secret-redaction paths
    config-service.ts          validates bootstrap env vars at startup
    mongo-service.ts           Mongo connection, driven by real heartbeat events
    crypto.ts                  AES-256-GCM for destination stream keys at rest
    http.ts / http-session.ts  response helpers, cookie/bearer session extraction
  modules/                   one folder per domain — router (+ service where needed) + repository
    auth/                      registration/login, bootstrap-then-admin-gated
    users/                     user accounts, admin management + self-service editing
    profiles/                  per-user Mixcloud/YouTube/Twitch destination profiles
    relay/                     the RTMP relay itself — see below
      relay.repository.ts        which single profile is currently "active"
      nginx-config-renderer.ts   renders nginx.conf from a profile + buffer preset
      ingest-event-receiver.ts   validates nginx's on_publish/on_publish_done, emits Stream events
      relay.router.ts            loopback-only HTTP routes for the two callbacks above
      nginx-process-manager.ts   spawns/supervises/crash-loops the real nginx child process
    health/                    /health
  static/                    the dashboard UI (plain HTML/CSS/JS, no build step)
docker/
  nginx.conf.template        the template NginxConfigRenderer fills in per active profile
  server.sh                  container startup & shutdown script (runs as PID 1, pre-flight validation, graceful SIGTERM handling)
Dockerfile                   3-stage build: nginx+rtmp-module, Bun sidecar compile, runtime
scripts/
  install.sh                 one-shot local install (see Quick start)
  check-spec-sync.ts         openapi.yaml <-> TECHNICAL.md drift check
tests/
  unit/                      no external deps
  integration/               needs a live Mongo (MONGO_TEST_URI, defaults to the docker-compose one)
docs/
  TECHNICAL.md               source of truth — read this before writing any code
  ARCHITECTURE.md            short, dated decision log
  SHUTDOWN.md                server startup/shutdown reference, module dispose methods, testing procedures
  STEP8-INFRASTRUCTURE.md    build order step 8: bootstrap script, graceful shutdown, documentation
  design-briefs/             screen/journey specs for the dashboard UI
openapi.yaml                 second source of truth — the API contract
```

## API overview

Full contract lives in [`openapi.yaml`](openapi.yaml) (kept in sync with `docs/TECHNICAL.md` automatically — see `scripts/check-spec-sync.ts`). At a glance:

| Endpoint | Auth | What |
|---|---|---|
| `POST /auth/register` | none for the very first call (bootstrap admin), admin JWT for every call after | Create a user account |
| `POST /auth/login` / implicit `POST /auth/logout` | — | Session cookie + bearer token |
| `GET /profile` / `PUT /profile` | user | Your own destination profile (Mixcloud/YouTube/Twitch keys) |
| `POST /profile/activate` | user | Make your profile the one active broadcast |
| `GET /users` | admin | List every account, with role/profile/active status |
| `PATCH /users/{userId}` | admin, or self for email/password | Edit an account — role changes are admin-only |
| `DELETE /users/{userId}` | admin | Remove an account (cascades its destination profile) |
| `POST /users/{userId}/activate` | admin | Activate any user's profile on their behalf |
| `GET /health` | none | Mongo/nginx reachability, ingest status |
| `GET /stats`, `GET /events` | — | Placeholders — `StreamState`/SSE aren't built yet |
| `POST /internal/nginx/on-publish*` | internal, loopback-only | nginx-rtmp's own notify callbacks — validates the stream key against the active profile, emits `StreamStarted`/`StreamEnded` |

## Docs

Read in this order before touching code:

1. [`docs/TECHNICAL.md`](docs/TECHNICAL.md) — **The source of truth.** Architecture, module design, event taxonomy, persistence, auth, error handling, CI/CD, security suite, build order.
2. [`openapi.yaml`](openapi.yaml) — the API contract. Never invent an endpoint that isn't here.
3. [`docs/design-briefs/screens-and-journeys.md`](docs/design-briefs/screens-and-journeys.md) — every screen and user journey for the dashboard UI.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — short decision log with dates, for the "why" behind past calls.

### Additional references

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — cloud deployment guide with cost-efficient provider recommendations (Hetzner, DigitalOcean, AWS) and step-by-step setup instructions
- [`docs/SHUTDOWN.md`](docs/SHUTDOWN.md) — graceful shutdown reference, module dispose methods, Docker timeout behavior, testing procedures
- [`docs/STEP8-INFRASTRUCTURE.md`](docs/STEP8-INFRASTRUCTURE.md) — build order step 8: bootstrap script, pre-flight validation, shutdown infrastructure implementation summary

## Contributing

This is a public repo — `staging` is protected: every change lands via a feature branch → pull request → CI/security checks green → review, never a direct push.

```bash
git checkout -b feature/your-change staging
# ... make your change ...
bun run lint && bun run typecheck && bun run test && bun run test:integration
git push -u origin feature/your-change
gh pr create --base staging
```

A few things that'll save you a round-trip:

- **Docs before code.** If your change adds or alters behavior, update `docs/TECHNICAL.md` (and `openapi.yaml` if it touches the API) in the same PR — `check:spec-sync` runs in CI and fails on drift.
- Every PR into `staging` must pass all 5 required checks (lint/typecheck/tests/compile, spec sync, Spectral, gitleaks, Semgrep) and get one approval before it can merge.
- `main` only receives deliberate release merges — never target it directly.

## CI/CD

Two workflows, both required on every PR into `staging` and on `staging → main`:

- **[CI](.github/workflows/ci.yml)** — spec sync, lint (Biome), typecheck, unit tests, integration tests (against a real Mongo service container), compile (`bun build --compile`). No Docker-build job in this workflow yet — the `Dockerfile` itself builds and runs for real (nginx + `nginx-rtmp-module` compiled in, a build-time `nginx -t` self-test, the sidecar boots and actually spawns/supervises nginx — verified end-to-end in a live container, not just `docker build` succeeding), but the CI job that builds it on every PR hasn't been added yet — see `docs/TECHNICAL.md` §CI/CD pipeline for the planned shape (unconditional once added; the slower ffmpeg end-to-end suite stays a separate, path-filtered workflow, since it's where the one still-open question — does an nginx reload cleanly repoint an already-live push? — finally gets answered empirically).
- **[Security](.github/workflows/security.yml)** — gitleaks (secret scan, full history), Semgrep (project-specific rules in `.semgrep/security.yml` — `updatedBy`/`registeredBy`/`activatedBy` must never come from a request body, not generic OWASP noise), Spectral (`.spectral.yaml` — every `openapi.yaml` operation must declare a `security` block).

Branch flow: `feature/* → staging → main`, `staging` always green, `main` receives only deliberate merges. See `docs/TECHNICAL.md` §CI/CD pipeline for the full reasoning, including what these checks *can't* catch (the two conditional-auth cases documented in `openapi.yaml`'s own `info.description`).

## Debugging

### Structured logging & DEBUG mode

The sidecar uses **Pino** for structured logging. By default, logs are emitted as JSON (machine-readable, production-friendly). For development, enable DEBUG mode for pretty-printed, human-readable output:

**Local development:**
```bash
DEBUG=1 bun run dev    # pretty-printed logs with colors
```

**Docker deployment:**
```bash
DEBUG=1 docker compose up    # relay container logs in pretty-print mode
```

**Log levels** (in order of verbosity):
- `debug` — detailed startup steps, module initialization, event handling
- `info` — startup complete, server listening, important state changes (default)
- `warn` — connection failures, retries, graceful degradation
- `error` — unrecoverable errors
- `fatal` — process-level failures, exits

**Examples:**

```bash
# Pretty-print debug logs (development)
DEBUG=1 bun run dev

# JSON logs at debug level (logs to a file for analysis)
LOG_LEVEL=debug bun run dev

# Filter to warnings only (quiet production monitoring)
LOG_LEVEL=warn docker compose up

# Combine both: pretty-print at a specific level
DEBUG=1 LOG_LEVEL=warn bun run dev
```

All logs include context (module name, request ID, error messages, stack traces where relevant), and sensitive fields (stream keys, passwords, tokens) are automatically redacted.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ConfigService` throws listing missing env vars | `.env` is missing or incomplete — run `./scripts/install.sh` or copy `.env.example` and fill in `JWT_SECRET`/`ENCRYPTION_KEY`. |
| Can't connect to Mongo | `docker compose up -d mongo` — check `docker ps` shows it on `27117`, not the default `27017`. |
| Edited `src/static/*` but the browser doesn't reflect it | Static files aren't watched — restart `bun run dev` (see [Working on the frontend](#working-on-the-frontend)). |
| `bun run test:integration` fails to connect | Needs the Mongo container running — same fix as above. Uses `MONGO_TEST_URI` if set, otherwise the same URI as dev. |
| Registration returns 401/403 after the first account | Working as intended — only the very first call (empty `users` collection) is unauthenticated. Every account after that needs an admin JWT, via the dashboard's "Register a user" form while logged in as admin. |
| Sidecar exits with code 1 but no error message | Enable DEBUG mode with `DEBUG=1 bun run dev` to see detailed startup logs and the actual error. |

## License

MIT — see [LICENSE](LICENSE).

---

> [!WARNING]
> **This software is in BETA.** It relays your live broadcast to real destinations — test it on your own risk, and don't point it at anything you can't afford to have drop, glitch, or fail silently while you're still learning its edges. See [Status](#status--beta-relay-build-in-progress) above for exactly what's verified and what isn't yet.

<p align="center">Shout out to the Mixcloud massif!</p>
