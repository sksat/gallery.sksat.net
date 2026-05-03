# CLAUDE.md (admin)

Admin panel for gallery.sksat.net. This is a separate Qwik/QwikCity project under `admin/` with its own `package.json`, `node_modules`, and Cloudflare Pages deployment. Read alongside the root [CLAUDE.md](../CLAUDE.md) — workflow rules, fixture conventions, and VRT baseline policy are inherited from there.

## Differences from the root project

- **Dev port**: `5175` (root uses `5174` for Playwright). Avoids conflicts when both projects' dev servers are running.
- **Routing**: Currently a single `/` dashboard (`src/routes/index.tsx`). No fixture data needed yet.
- **Auth**: Production is behind Cloudflare Access. Local dev has no auth — `pnpm dev` serves the dashboard at `http://localhost:5175` (use `pnpm start` if you want it to auto-open in a browser).
- **Bindings**: D1 `DB` (metadata source of truth, see [migrations/](migrations/)). R2 (Phase 3+) and image upload (Phase 4) are not wired yet. Tests run against a real local D1 (sequenced via `e2e/start-test-server.sh` so wrangler dev opens the file _after_ seeding).
- **Publish path**: D1 → JSON dump → B2 S3-compatible `PUT /media.json` via `aws4fetch`. The public gallery still reads the static `media.json`; the admin's "Publish" button is the only writer.

## Commands

```bash
cd admin
pnpm install
pnpm dev             # http://localhost:5175 (vite dev — D1 binding NOT wired here)
pnpm serve           # wrangler pages dev (D1 binding wired; use this for /media, /api, publish)
pnpm run build.types # tsc --noEmit
pnpm test            # Vitest
pnpm run test.e2e    # Playwright E2E (e2e/*.spec.ts) — runs e2e/start-test-server.sh
pnpm run test.vrt    # Playwright VRT (e2e/vrt/*.vrt.spec.ts)
pnpm run test.vrt.update
pnpm run build       # qwik build
pnpm run deploy      # wrangler pages publish ./dist

# D1 lifecycle (see README.md for the full flow)
pnpm db.migrate.local
pnpm import-media && pnpm db.seed.local
```

## Test layout

- `e2e/smoke.spec.ts` — `/` returns 200 and renders the dashboard heading
- `e2e/media-list.spec.ts`, `e2e/media-edit.spec.ts` — `/media` flows
- `e2e/vrt/*.vrt.spec.ts` — visual baselines (`/`, `/media`)
- `src/**/*.spec.ts` — pure-function unit tests (`db.ts`, `validate.ts`)

`POST /api/publish` has no E2E coverage on purpose: a faithful test would have to mock SigV4 + the B2 round-trip. Verify manually after deploy until B2 secrets land in CI.

VRT baselines must be regenerated on Linux/Chromium (CI) — same rule as the root project. Use `playwright install --with-deps chromium` (matches CI) rather than the Playwright Docker image; the two render slightly differently and CI runs the former.
