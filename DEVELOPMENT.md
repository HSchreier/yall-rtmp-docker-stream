# Development Guide

## Setup

### 1. Install Git Hooks (Required)

```bash
./scripts/setup-hooks.sh
```

This configures a `pre-push` hook that **blocks all pushes** unless the local replica suite passes. No more ping-pong between your machine and GitHub CI.

### 2. Install Dependencies

```bash
bun install                    # Backend
cd frontend && bun install     # Frontend
```

### 3. Start MongoDB (for integration tests)

```bash
docker-compose up mongo
```

### 4. Run Replica Suite Locally

Before **every** push, run:

```bash
./scripts/replica-suite.sh
```

This runs **all** checks that GitHub CI will run:
- ✅ Backend lint (Biome)
- ✅ Backend type check (TypeScript)
- ✅ Backend unit tests (Bun test)
- ✅ Backend integration tests (requires MongoDB)
- ✅ Backend compilation (bun build --compile)
- ✅ Frontend type check (TypeScript)
- ✅ Frontend build (Vite)

If any check fails, your push is blocked with clear error output. Fix locally, then retry.

## Development Workflow

### Feature Branch

```bash
# Create branch
git checkout -b feature/add-dashboard-component

# Make changes, test locally
./scripts/replica-suite.sh

# Commit + push (pre-push hook runs replica suite)
git add .
git commit -m "feat(dashboard): add streaming status component"
git push origin feature/add-dashboard-component
```

**If replica suite fails:**
- Error output is printed to terminal
- Your push is blocked
- Fix the error
- Run replica suite again
- Try push again

### Running Tests in Development

**Unit tests only (fast, ~1 sec):**
```bash
bun test tests/unit/
```

**Integration tests (requires MongoDB, ~5 sec):**
```bash
bun test tests/integration/
```

**All tests:**
```bash
bun test
```

**Watch mode (auto-rerun on file change):**
```bash
bun test --watch
```

### Running Linters

**Lint + auto-fix:**
```bash
bunx @biomejs/biome check --write --unsafe src/ scripts/ tests/
```

**Type check:**
```bash
bunx tsc --noEmit
```

**Frontend type check:**
```bash
cd frontend && bun run type-check
```

## Git Workflow

```
feature/xyz
    ↓ [CI: spec-sync, backend lint/test, frontend build, docker build]
    ↓ PR approved
staging
    ↓ [CI: all checks + docker push]
    ↓ Manual merge (after testing in staging)
main
    ↓ [Tagged release v0.x.y]
```

**Rules:**
- Never commit directly to `main` or `staging`
- Always create a feature branch
- Every push triggers CI automatically
- All checks must pass before merge

## CI/CD Pipeline

Three separate workflows:

### 1. **Security** (`.github/workflows/security.yml`)

Runs on every push + PR:
- Secret scanning (gitleaks) — prevents hardcoded API keys
- SAST (Semgrep) — detects unsafe patterns (role from body, etc.)
- OpenAPI lint (Spectral) — ensures all endpoints are authenticated

### 2. **CI** (`.github/workflows/ci.yml`)

Runs on every push + PR:
- Spec sync check — openapi.yaml ↔ TECHNICAL.md
- Backend: lint, typecheck, unit tests, integration tests, compile
- Frontend: typecheck, build
- Docker build (staging/main only)

### 3. **Local Replica** (`.githooks/pre-push`)

**Runs on your machine before push:**
- Same checks as CI, but locally
- Blocks push if anything fails
- Instant feedback, no waiting for GitHub

## Troubleshooting

### "Replica suite is slow"

It runs the full build pipeline, which takes ~3–5 minutes on a cold cache. On subsequent runs with no changes, it's faster (~10 sec).

To skip tests during development (but CI will still run them):
```bash
git push --no-verify
```

⚠️ Only do this if you've already run replica suite and know it passes.

### "CI is failing but replica suite passed locally"

**Possible causes:**
- Node version mismatch
- Different OS (macOS vs Linux)
- Lockfile out of sync
- Environment variable differences

**Fix:**
```bash
nvm use 22
bun install --frozen-lockfile
./scripts/replica-suite.sh
```

### "I committed something I shouldn't have"

**If not yet pushed:**
```bash
git reset --soft HEAD~1
git restore --staged .
# ... remove the file
git add .
git commit -m "fix: remove secret"
```

**If already pushed:**
```bash
git revert <commit-hash>
git push
```

Then rotate any exposed secrets (API keys, tokens, etc.).

### "Docker build is slow"

First build is slow (compiling backend). Subsequent builds use layer cache.

To force a clean build:
```bash
docker system prune -a
docker build .
```

## Testing Strategy

### Unit Tests
- Fast (~1 sec)
- No external services
- Test EventBus, utilities, pure functions
- Run on every code change

### Integration Tests
- Requires MongoDB
- Real HTTP endpoints
- Auth flow, database operations
- Run before push (in replica suite)

### E2E Tests (TBD)
- Real OBS instance → nginx → relay
- Verify stream actually flows
- Monthly or before release

## Code Quality

### Type Safety

All code is TypeScript with `strict: true`. No `any`, no `@ts-ignore`.

```bash
bunx tsc --noEmit
```

### Linting

Backend uses Biome:

```bash
bunx @biomejs/biome check --write --unsafe src/
```

**Key rules:**
- No console.log outside debug mode
- No unused variables
- No forEach with side effects (use for...of)

Frontend uses TypeScript:

```bash
cd frontend && bun run type-check
```

### Security

**Invariants enforced by Semgrep:**
- `role` must come from JWT, never from request body
- `updatedBy`/`registeredBy`/`activatedBy` must be from JWT, never body
- No secrets in event payloads

## Documentation

- `docs/TECHNICAL.md` — Architecture, modules, build order
- `docs/CI_CD.md` — CI/CD workflows, testing, security
- `FRONTEND_ARCHITECTURE.md` — Frontend structure, EventBus, state management
- `FRONTEND_SETUP.md` — Quick start for frontend development

## Useful Commands

```bash
# Replica suite (all checks before push)
./scripts/replica-suite.sh

# Unit tests only
bun test tests/unit/

# Integration tests
bun test tests/integration/

# Watch mode (re-run on change)
bun test --watch

# Lint + auto-fix
bunx @biomejs/biome check --write --unsafe src/

# Type check
bunx tsc --noEmit

# Build backend
bun run build

# Build frontend
cd frontend && bun run build

# Run dev server (backend)
bun run dev

# Run dev server (frontend)
cd frontend && bun run dev

# Start MongoDB for tests
docker-compose up mongo

# Run security scans
./gitleaks detect --source . --config .gitleaks.toml
semgrep --config .semgrep/

# Inspect git hooks
git config core.hooksPath
```

## Questions?

See the full guides:
- `docs/CI_CD.md` for workflow details
- `FRONTEND_ARCHITECTURE.md` for frontend development
- `docs/TECHNICAL.md` for backend architecture
