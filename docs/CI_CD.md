# CI/CD & Testing

## Overview

Three-layered automated verification:

1. **Security** (`.github/workflows/security.yml`)
   - Secret scanning (gitleaks)
   - SAST (Semgrep)
   - OpenAPI security lint

2. **CI** (`.github/workflows/ci.yml`)
   - Spec sync check
   - Backend: lint, typecheck, unit tests, integration tests, compile
   - Frontend: typecheck, build
   - Docker image build

3. **Local replica** (developer machine before push)
   - `bun run lint && bun run build && bun test`
   - `cd frontend && bun run type-check && bun run build`

## Branch Flow

```
feature/fix-xyz → [CI passes] → staging → [CI + integration] → main
                                   ↑
                             Can only merge if CI green
```

- **feature branches**: CI runs on push; must pass before PR merge
- **staging**: CI + Docker build
- **main**: CI + Docker build + tagged release (manual)

## GitHub Actions Workflows

### Security (`security.yml`)

**Runs on:** Every push + PR  
**Time:** ~1 min

| Job | Purpose | Blocking |
|-----|---------|----------|
| `secret-scan` | gitleaks (no hardcoded creds) | ⚠️ Advisory only |
| `sast` | Semgrep (invariants: updatedBy from JWT, not body) | ❌ ERROR-level blocks |
| `spec-security` | Spectral (every endpoint must have `security` block) | ❌ Blocks |

**Config files:**
- `.gitleaks.toml` — secret patterns
- `.semgrep/` — invariant rules (updatedBy, registeredBy, etc.)
- `.spectral.yaml` — OpenAPI lint rules

### CI (`ci.yml`)

**Runs on:** Every push (main, staging, feature/*) + PR  
**Time:** ~3–5 min total

| Job | Purpose | Blocking |
|-----|---------|----------|
| `spec-sync` | Verify openapi.yaml ↔ TECHNICAL.md | ❌ Blocks |
| `build-and-test` | Backend: lint, typecheck, unit, integration, compile | ❌ Blocks |
| `frontend-build-and-test` | Frontend: typecheck, build | ❌ Blocks |
| `docker-build` | Docker image build (staging/main only) | ⚠️ Advisory |

**On success:** Builds `dist/sidecar` (backend binary) + `frontend/dist/` (static files)

**Secrets required in GitHub repo:**
None — this workflow is public-only. For Docker push (TBD), requires `DOCKER_USERNAME` + `DOCKER_TOKEN`.

## Local Development: Replica Suite

Before pushing, run the full replica locally:

```bash
# Backend
bun install --frozen-lockfile
bunx @biomejs/biome check src/ scripts/ tests/
bunx tsc --noEmit
bun test tests/unit/
bun test tests/integration/    # Requires `docker-compose up mongo`
bun build ./src/index.ts --compile --outfile dist/sidecar

# Frontend
cd frontend && bun install --frozen-lockfile
bun run type-check
bun run build
```

Or use a convenience script (TBD):

```bash
./scripts/replica-suite.sh
```

## Testing

### Unit Tests (`tests/unit/`)

Bun test runner, no external services.

```bash
bun test tests/unit/
```

**Coverage:** EventBus, EventEmitter, utility functions, no I/O.

**Example:**

```typescript
// tests/unit/event-bus.test.ts
import { describe, it, expect } from "bun:test";
import { EventBus } from "../../src/infra/event-bus";

describe("EventBus", () => {
  it("emits and listens to events", () => {
    const bus = new EventBus();
    const listener = () => {};
    
    bus.on("test:event", listener);
    expect(() => bus.emit("test:event", { data: "test" })).not.toThrow();
  });
});
```

### Integration Tests (`tests/integration/`)

Requires MongoDB (via docker-compose).

```bash
docker-compose up -d mongo
bun test tests/integration/
docker-compose down
```

**Coverage:** API endpoints with real Mongo, real HTTP calls, auth flow.

**Example:**

```typescript
// tests/integration/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { MongoClient } from "mongodb";

describe("Auth endpoints", () => {
  let mongo: MongoClient;

  beforeAll(async () => {
    mongo = new MongoClient(process.env.MONGO_TEST_URI!);
    await mongo.connect();
  });

  afterAll(async () => {
    await mongo.close();
  });

  it("POST /auth/login returns token on valid credentials", async () => {
    const res = await fetch("http://localhost:8080/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "SecurePass123!" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string };
    expect(data.token).toBeTruthy();
  });
});
```

### Frontend Component Tests (TBD)

Use Vitest + React Testing Library:

```bash
cd frontend
bun add -D vitest @testing-library/react
bun run test
```

## Linting & Type Checking

### Backend

**Lint (Biome):**
```bash
bunx @biomejs/biome check src/ scripts/ tests/
# Auto-fix:
bunx @biomejs/biome check --write --unsafe src/
```

**Rules:**
- No console.log in production
- No `forEach` with side effects (use `for...of`)
- No unhandled promise rejections
- No unused variables

**Type check:**
```bash
bunx tsc --noEmit
```

### Frontend

**Type check:**
```bash
cd frontend && bun run type-check
```

Runs `tsc --noEmit` with `strict: true` — no any, no non-null assertions.

## Spec Sync

Ensures `openapi.yaml` stays in sync with `docs/TECHNICAL.md`.

```bash
bun scripts/check-spec-sync.ts
```

**What it checks:**
- Every endpoint in openapi.yaml exists in TECHNICAL.md
- Every type in TECHNICAL.md is documented
- Paths match exactly

This is the authoritative check that the spec is the source of truth.

## Security Scanning

### Secrets (gitleaks)

Detects hardcoded API keys, passwords, tokens.

```bash
./gitleaks detect --source . --config .gitleaks.toml
```

**Rules in `.gitleaks.toml`:**
- AWS keys
- GitHub tokens
- Private keys
- Database passwords

**What to do:** Never commit secrets. Use environment variables or `.env` files (git-ignored).

### SAST (Semgrep)

Analyzes code patterns for security issues.

```bash
pip install semgrep
semgrep --config .semgrep/ --severity ERROR
```

**Blocking rules (`.semgrep/invariants.yml`):**
- Role/permissions must come from verified JWT, never from request body
- `updatedBy`/`registeredBy`/`activatedBy` fields must come from JWT `sub`, never body
- Event payloads must not expose secrets

**Advisory rules (`.semgrep/security.yml`):**
- Role hardcoded in request body (flagged, not blocking)
- Suspicious JSON fields that look like secrets

### OpenAPI Security (Spectral)

Ensures every endpoint requires authentication.

```bash
bunx @stoplight/spectral-cli lint openapi.yaml --ruleset .spectral.yaml
```

**Blocking rules:**
- Every operation must have explicit `security: []` block (even if empty)
- No passwords in query strings
- Request/response schemas must not contain `password` fields at the top level

## Docker Build

Builds the complete image with backend binary + frontend static files.

```bash
docker build -t yall-rtmp:latest .
```

**Multi-stage Dockerfile:**

1. **Backend stage**
   - Base: oven/bun
   - Install deps
   - Compile to `dist/sidecar`

2. **Frontend stage**
   - Base: oven/bun
   - Install deps
   - Build to `frontend/dist/`

3. **Final stage**
   - Base: alpine (or debian:bookworm-slim)
   - Copy `dist/sidecar` → `/app/sidecar`
   - Copy `frontend/dist/` → `/app/public/`
   - Start with `/app/sidecar`

**CI builds:** On staging/main pushes, builds but doesn't push (cost savings).

## Common Issues

### "CI is failing, but tests pass locally"

**Likely causes:**
- Node version mismatch (use `nvm use 22`)
- Lockfile changed (run `bun install --frozen-lockfile`)
- Env vars missing in CI (check `.github/workflows/ci.yml`)
- Race condition in integration test (use `beforeAll`/`afterAll`)

**Fix:**
```bash
nvm use 22
bun install --frozen-lockfile
bun test
```

### "Secret scan is blocking my PR"

**Check:**
```bash
git diff HEAD origin/main | grep -E 'password|secret|token|key'
```

Remove any secrets, commit, and re-push.

### "Type check fails in CI but not locally"

**Likely cause:** Different TypeScript version.

**Fix:**
```bash
bun install --frozen-lockfile
bunx tsc --noEmit
```

## CI Badges

Add to `README.md`:

```markdown
[![CI](https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/ci.yml)
[![Security](https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/HSchreier/yall-rtmp-docker-stream/actions/workflows/security.yml)
```

## Future Enhancements

- [ ] Integration test suite with synthetic RTMP stream (ffmpeg)
- [ ] Performance benchmarks (streaming bitrate under load)
- [ ] Docker image push to Docker Hub on release
- [ ] Automated versioning + changelog on main merge
- [ ] Coverage reports (Codecov)
- [ ] E2E tests with real OBS instance
