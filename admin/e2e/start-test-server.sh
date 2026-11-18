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

rm -rf "$PERSIST_DIR" "${PERSIST_DIR}-noauth"
pnpm exec wrangler d1 migrations apply gallery-admin \
  --local --persist-to "$PERSIST_DIR"

pnpm exec wrangler d1 execute gallery-admin \
  --local --persist-to "$PERSIST_DIR" \
  --file=e2e/fixture.sql

# A second server on PORT+1 WITHOUT the Access bypass, so e2e/access.spec.ts
# can prove the JWT check (src/routes/plugin@access.ts) is actually wired in.
# It has its own persist dir and never reaches D1 (requests are rejected).
NOAUTH_PORT=$((PORT + 1))
pnpm exec wrangler pages dev ./dist \
  --persist-to "${PERSIST_DIR}-noauth" \
  --inspector-port $((NOAUTH_PORT + 4000)) \
  --ip 127.0.0.1 --port "$NOAUTH_PORT" &
NOAUTH_PID=$!

# Uploads go to a fake bucket on PORT+2 (e2e/fake-b2.mjs) that checks the
# presigned PUTs with this test key. Never the real B2.
FAKE_B2_PORT=$((PORT + 2))
node e2e/fake-b2.mjs "$FAKE_B2_PORT" sksat-gallery e2e-key-id e2e-secret us-west-002 &
FAKE_B2_PID=$!

# The dashboard's usage and access cards ask a fake GraphQL Analytics API
# on PORT+3 (e2e/fake-graphql.mjs) with this test token. Never the real one.
FAKE_GRAPHQL_PORT=$((PORT + 3))
node e2e/fake-graphql.mjs "$FAKE_GRAPHQL_PORT" e2e-analytics-token \
  5e9a7cb92cdd4aedafe02f1f547e7b4c gallery.sksat.net &
FAKE_GRAPHQL_PID=$!
trap 'kill "$NOAUTH_PID" "$FAKE_B2_PID" "$FAKE_GRAPHQL_PID" 2>/dev/null || true' EXIT INT TERM

# ACCESS_DISABLED=1: there is no Cloudflare Access in front of the local
# server, so skip JWT verification for the functional E2E server only.
# (Honoured only for loopback hostnames — see src/lib/access.ts.)
# THUMBNAILS is blanked so thumbnails render as deterministic placeholder
# tiles: the image Worker (IMAGES binding) is not running locally, and VRT
# does not depend on it. E2E_TEST_ROUTES=1 enables /e2e/* pages (loopback
# only), e.g. the photo preview with thumbnails Playwright serves itself.
pnpm exec wrangler pages dev ./dist \
  --persist-to "$PERSIST_DIR" \
  --binding ACCESS_DISABLED=1 \
  --binding THUMBNAILS= \
  --binding E2E_TEST_ROUTES=1 \
  --binding "B2_ENDPOINT=http://127.0.0.1:${FAKE_B2_PORT}" \
  --binding B2_UPLOAD_KEY_ID=e2e-key-id \
  --binding B2_UPLOAD_APPLICATION_KEY=e2e-secret \
  --binding "E2E_FAKE_B2_STAT_URL=http://127.0.0.1:${FAKE_B2_PORT}/__stat" \
  --binding CF_ANALYTICS_API_TOKEN=e2e-analytics-token \
  --binding "E2E_FAKE_GRAPHQL_URL=http://127.0.0.1:${FAKE_GRAPHQL_PORT}/" \
  --ip 127.0.0.1 --port "$PORT" &
wait $!
