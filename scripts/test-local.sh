#!/usr/bin/env bash
set -euo pipefail

# Local CI Mirror — runs same checks as GitHub Actions before pushing
# Usage: ./scripts/test-local.sh
# Or: git push (runs automatically via pre-push hook)

echo ""
echo "🧪 Running Local CI Mirror Tests..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0

run_test() {
  local name="$1"
  shift

  printf "  %-50s " "$name"
  if "$@" > /tmp/test-output.txt 2>&1; then
    echo -e "${GREEN}✓${NC}"
    ((PASS++))
  else
    echo -e "${RED}✗${NC}"
    ((FAIL++))
    echo ""
    echo -e "${RED}Error output:${NC}"
    cat /tmp/test-output.txt | sed 's/^/    /'
    echo ""
  fi
}

echo -e "${BLUE}Linting & Formatting${NC}"
run_test "Biome lint/format check" bunx @biomejs/biome check src/ scripts/ tests/

echo ""
echo -e "${BLUE}Type Safety${NC}"
run_test "TypeScript type check" bunx tsc --noEmit

echo ""
echo -e "${BLUE}Security${NC}"
if command -v gitleaks &> /dev/null; then
  run_test "Gitleaks secret scan" gitleaks detect --source . --redact --no-banner --exit-code 1
else
  printf "  %-50s " "Gitleaks secret scan"
  echo -e "${YELLOW}⊘${NC} (not installed, skipping)"
fi

echo ""
echo -e "${BLUE}Spec & Documentation${NC}"
run_test "Spec sync check" bun scripts/check-spec-sync.ts

echo ""
echo -e "${BLUE}Testing${NC}"
run_test "Unit tests" bun test

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}❌ Tests failed. Fix issues before pushing.${NC}"
  echo ""
  exit 1
else
  echo -e "${GREEN}✅ All tests passed! Ready to push.${NC}"
  echo ""
  exit 0
fi
