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

# Ya'll Cast

A single containerized agent that takes one RTMP ingest from OBS and relays it live, unmodified, to Mixcloud Live, YouTube, and Twitch at once. Per-user destination profiles (each with its own stream keys), one active broadcast at a time, auth-gated config, fully event-driven — no polling, no unscoped timers.

## Status — first unstable release

**[v0.1.0-alpha.1](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1) — the RTMP relay itself does not exist yet.**

| Built and verified | Not built yet |
|---|---|
| Auth (bootstrap admin, register, login) | `nginx-rtmp-module` relay itself |
| Per-user destination profiles (Mixcloud/YouTube/Twitch keys) | `StreamState` / live "is it actually streaming" status |
| One-active-profile activation, incl. admin-activate-for-anyone | Real-time status via SSE |
| Full browser dashboard UI (not just a JSON API) | Docker image for the relay (no `Dockerfile` yet) |
| Admin user-management table | |

See the [release notes](https://github.com/HSchreier/yall-rtmp-docker-stream/releases/tag/v0.1.0-alpha.1) for the full breakdown and [`docs/TECHNICAL.md`](docs/TECHNICAL.md)'s "Open questions" section for what's still unresolved.

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
3. Copies `.env.example` → `.env` and fills in a freshly generated `JWT_SECRET`. Safe to re-run — won't touch an existing `.env`.
4. Runs `bun install`.
5. Starts Mongo (`docker compose up -d mongo`) on `localhost:27117`.

Then start the app:

```bash
bun run dev
```

Open **http://localhost:8080** — first visit walks you through creating the administrator account. No separate seed step, no CLI command to remember.

## Manual setup (if you'd rather not run the script)

```bash
docker compose up -d mongo        # Mongo 7, host-mapped to localhost:27117
cp .env.example .env              # then fill in JWT_SECRET yourself, e.g.:
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
| `HTTP_PORT` | no (defaults to `8080`) | Where the dashboard/API listens. |

Destination stream keys (Mixcloud/YouTube/Twitch) are **not** env vars — they live in Mongo, per user, set through the dashboard itself after you log in.

## Available scripts

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

## Working on the frontend

The dashboard (`src/static/*.html`, `app.js`, `app.css`) is served as static files, read into memory **once** at boot — it is **not** in Bun's `--watch` dependency graph. If you edit anything under `src/static/`, you need to restart the dev server for the change to show up:

```bash
# Ctrl+C the running `bun run dev`, then:
bun run dev
```

Editing `src/**/*.ts` (routes, services, repositories) does auto-restart via `--watch`.

## Project layout

```
src/
  bootstrap.ts              composition root — the only place that wires everything together
  index.ts                  entrypoint
  event-bus.ts               typed EventBus — all cross-module side effects go through this
  events.ts                  the full EventMap (every event this app can emit)
  errors.ts                  typed error hierarchy (ValidationError, AuthError, ...)
  logger.ts                  Pino wrapper with secret-redaction paths
  config-service.ts          validates env vars at startup
  mongo-service.ts           Mongo connection, driven by real heartbeat events
  http-api.ts                Bun.serve-based HTTP router (hand-rolled, no framework)
  auth-service.ts             registration/login, bootstrap-then-admin-gated
  user-repository.ts          user accounts
  destination-profile-repository.ts   per-user Mixcloud/YouTube/Twitch profiles
  relay-state-repository.ts   which single profile is currently "active"
  static/                     the dashboard UI (plain HTML/CSS/JS, no build step)
scripts/
  install.sh                  one-shot local install (see Quick start)
  check-spec-sync.ts           openapi.yaml <-> TECHNICAL.md drift check
tests/
  unit/                        no external deps
  integration/                 needs a live Mongo (MONGO_TEST_URI, defaults to the docker-compose one)
docs/
  TECHNICAL.md                 source of truth — read this before writing any code
  ARCHITECTURE.md              short, dated decision log
  design-briefs/               screen/journey specs for the dashboard UI
openapi.yaml                   second source of truth — the API contract
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
| `POST /users/{userId}/activate` | admin | Activate any user's profile on their behalf |
| `GET /health` | none | Mongo/nginx reachability, ingest status |
| `GET /stats`, `GET /events` | — | Placeholders — `StreamState`/SSE aren't built yet |
| `POST /internal/nginx/on-publish*` | internal | Webhook nginx will call once the relay exists |

## Docs

Read in this order before touching code:

1. [`docs/TECHNICAL.md`](docs/TECHNICAL.md) — architecture, module design, event taxonomy, persistence, auth, error handling, CI/CD, security suite. **The source of truth.**
2. [`openapi.yaml`](openapi.yaml) — the API contract. Never invent an endpoint that isn't here.
3. [`docs/design-briefs/screens-and-journeys.md`](docs/design-briefs/screens-and-journeys.md) — every screen and user journey for the dashboard UI.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — short decision log with dates, for the "why" behind past calls.

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

- **[CI](.github/workflows/ci.yml)** — spec sync, lint (Biome), typecheck, unit tests, integration tests (against a real Mongo service container), compile (`bun build --compile`). No Docker-build job in this workflow yet — the `Dockerfile` itself now exists and builds/runs (verified: `nginx-rtmp-module` compiles in, the sidecar boots), but the CI job that builds it on every PR hasn't been added — see `docs/TECHNICAL.md` §CI/CD pipeline for the planned shape (unconditional once added; the slower ffmpeg end-to-end suite stays a separate, path-filtered workflow).
- **[Security](.github/workflows/security.yml)** — gitleaks (secret scan, full history), Semgrep (project-specific rules in `.semgrep/security.yml` — `updatedBy`/`registeredBy`/`activatedBy` must never come from a request body, not generic OWASP noise), Spectral (`.spectral.yaml` — every `openapi.yaml` operation must declare a `security` block).

Branch flow: `feature/* → staging → main`, `staging` always green, `main` receives only deliberate merges. See `docs/TECHNICAL.md` §CI/CD pipeline for the full reasoning, including what these checks *can't* catch (the two conditional-auth cases documented in `openapi.yaml`'s own `info.description`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ConfigService` throws listing missing env vars | `.env` is missing or incomplete — run `./scripts/install.sh` or copy `.env.example` and fill in `JWT_SECRET`. |
| Can't connect to Mongo | `docker compose up -d mongo` — check `docker ps` shows it on `27117`, not the default `27017`. |
| Edited `src/static/*` but the browser doesn't reflect it | Static files aren't watched — restart `bun run dev` (see [Working on the frontend](#working-on-the-frontend)). |
| `bun run test:integration` fails to connect | Needs the Mongo container running — same fix as above. Uses `MONGO_TEST_URI` if set, otherwise the same URI as dev. |
| Registration returns 401/403 after the first account | Working as intended — only the very first call (empty `users` collection) is unauthenticated. Every account after that needs an admin JWT, via the dashboard's "Register a user" form while logged in as admin. |

## License

MIT — see [LICENSE](LICENSE).
