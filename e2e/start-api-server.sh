#!/usr/bin/env bash
# Started by playwright.config.ts: the API Worker (workers/api) on a local D1
# that has the admin's migrations and e2e/fixture.sql, so E2E and VRT read
# the photo list through the real API code and SQL. Everything happens in
# this one command because Playwright starts its web servers in parallel.
set -euo pipefail

PORT="${1:-5178}"
PERSIST_DIR=".wrangler-e2e"
CONFIG="workers/api/wrangler.jsonc"

cd "$(dirname "$0")/.."

rm -rf "$PERSIST_DIR"
for migration in admin/migrations/*.sql; do
  pnpm exec wrangler d1 execute gallery-admin -c "$CONFIG" \
    --local --persist-to "$PERSIST_DIR" --file "$migration" >/dev/null
done
pnpm exec wrangler d1 execute gallery-admin -c "$CONFIG" \
  --local --persist-to "$PERSIST_DIR" --file e2e/fixture.sql >/dev/null

exec pnpm exec wrangler dev -c "$CONFIG" \
  --persist-to "$PERSIST_DIR" \
  --ip 127.0.0.1 --port "$PORT" --inspector-port $((PORT + 4000))
