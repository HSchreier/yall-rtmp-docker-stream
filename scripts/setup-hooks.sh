#!/usr/bin/env bash
# Install git hooks for local development

set -e

echo "Setting up git hooks..."

# Configure git to use .githooks directory
git config core.hooksPath .githooks

echo "✅ Git hooks configured"
echo ""
echo "Installed hooks:"
echo "  • pre-push: Runs replica suite before pushing"
echo ""
echo "To test manually:"
echo "  ./scripts/replica-suite.sh"
echo ""
echo "Your push will now automatically run the full test suite."
