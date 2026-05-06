#!/usr/bin/env bash
# Used by playwright.config.ts as the webServer command.
# Builds, resets the local D1 state, applies migrations + fixture, then
# launches wrangler pages dev. Sequencing matters: globalSetup runs in
# parallel with webServer in Playwright, so we keep all state preparation
# inside this single command.
#
# All wrangler invocations share --persist-to .wrangler-test so the test
# state lives next to (not inside) the developer's local .wrangler/ tree
# and we don't depend on wrangler's internal state-path layout (the
# previous `.wrangler/state/v3/d1` form was version-coupled).
set -euo pipefail

PORT="${1:-5175}"
PERSIST_DIR=".wrangler-test"

cd "$(dirname "$0")/.."

pnpm run build

rm -rf "$PERSIST_DIR"
pnpm exec wrangler d1 migrations apply gallery-admin \
  --local --persist-to "$PERSIST_DIR"

pnpm exec wrangler d1 execute gallery-admin \
  --local --persist-to "$PERSIST_DIR" \
  --file=e2e/fixture.sql

exec pnpm exec wrangler pages dev ./dist \
  --persist-to "$PERSIST_DIR" \
  --ip 127.0.0.1 --port "$PORT"
