#!/usr/bin/env bash
# Used by playwright.config.ts as the webServer command.
# Builds, resets the local D1 state, applies migrations + fixture, then
# launches wrangler pages dev. Sequencing matters: globalSetup runs in
# parallel with webServer in Playwright, so we keep all state preparation
# inside this single command.
set -euo pipefail

PORT="${1:-5175}"

cd "$(dirname "$0")/.."

pnpm run build

rm -rf .wrangler/state/v3/d1
pnpm exec wrangler d1 migrations apply gallery-admin --local

pnpm exec wrangler d1 execute gallery-admin --local --file=e2e/fixture.sql

exec pnpm exec wrangler pages dev ./dist --port "$PORT"
