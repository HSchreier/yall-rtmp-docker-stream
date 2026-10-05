#!/usr/bin/env bash
set -euo pipefail

# Local CI Mirror — fast pre-push check (Biome formatting)
# GitHub Actions runs the full suite; this is just formatting
# Usage: ./scripts/test-local.sh

echo ""
echo "🧪 Pre-push check: Biome formatting..."
echo ""

if bunx @biomejs/biome check src/ scripts/ tests/ 2>&1; then
  echo ""
  echo "✅ Formatting OK! Ready to push."
  echo ""
  exit 0
else
  echo ""
  echo "❌ Formatting issues found."
  echo "   Run: bunx @biomejs/biome check --write src/ scripts/ tests/"
  echo ""
  exit 1
fi
