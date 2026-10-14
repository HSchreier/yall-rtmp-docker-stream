#!/usr/bin/env bash
# Replica CI suite — run locally before pushing
# Replicates .github/workflows/ci.yml checks

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Starting replica CI suite..."
echo ""

# === Backend ===
echo "${YELLOW}[1/6]${NC} Backend: Installing dependencies..."
bun install --frozen-lockfile > /dev/null 2>&1

echo "${YELLOW}[2/6]${NC} Backend: Linting with Biome..."
if ! bunx @biomejs/biome check src/ scripts/ tests/ > /dev/null 2>&1; then
  echo "${RED}❌ Biome lint failed${NC}"
  bunx @biomejs/biome check src/ scripts/ tests/
  exit 1
fi
echo "${GREEN}✅ Biome lint passed${NC}"

echo "${YELLOW}[3/6]${NC} Backend: Type checking..."
if ! bunx tsc --noEmit > /dev/null 2>&1; then
  echo "${RED}❌ TypeScript type check failed${NC}"
  bunx tsc --noEmit
  exit 1
fi
echo "${GREEN}✅ Type check passed${NC}"

echo "${YELLOW}[4/6]${NC} Backend: Unit tests..."
if ! bun test tests/unit/ > /dev/null 2>&1; then
  echo "${RED}❌ Unit tests failed${NC}"
  bun test tests/unit/
  exit 1
fi
echo "${GREEN}✅ Unit tests passed${NC}"

# Integration tests require MongoDB
if docker ps | grep -q mongo; then
  echo "${YELLOW}[5/6]${NC} Backend: Integration tests..."
  if ! bun test tests/integration/ > /dev/null 2>&1; then
    echo "${RED}❌ Integration tests failed${NC}"
    bun test tests/integration/
    exit 1
  fi
  echo "${GREEN}✅ Integration tests passed${NC}"
else
  echo "${YELLOW}[5/6]${NC} Backend: Skipping integration tests (MongoDB not running)"
  echo "  → Run: docker-compose up mongo"
fi

echo "${YELLOW}[6/6]${NC} Backend: Compiling..."
if ! bun build ./src/index.ts --compile --outfile /tmp/sidecar-test > /dev/null 2>&1; then
  echo "${RED}❌ Compilation failed${NC}"
  bun build ./src/index.ts --compile --outfile /tmp/sidecar-test
  exit 1
fi
echo "${GREEN}✅ Compilation passed${NC}"

# === Frontend ===
echo ""
echo "${YELLOW}Frontend: Installing dependencies...${NC}"
cd frontend && bun install --frozen-lockfile > /dev/null 2>&1 && cd ..

echo "${YELLOW}Frontend: Type checking...${NC}"
if ! (cd frontend && bun run type-check > /dev/null 2>&1); then
  echo "${RED}❌ Frontend type check failed${NC}"
  (cd frontend && bun run type-check)
  exit 1
fi
echo "${GREEN}✅ Frontend type check passed${NC}"

echo "${YELLOW}Frontend: Building...${NC}"
if ! (cd frontend && bun run build > /dev/null 2>&1); then
  echo "${RED}❌ Frontend build failed${NC}"
  (cd frontend && bun run build)
  exit 1
fi
echo "${GREEN}✅ Frontend build passed${NC}"

echo ""
echo "${GREEN}✅ All replica suite checks passed!${NC}"
echo "You're ready to push."
