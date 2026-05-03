# CLAUDE.md (admin)

Admin panel for gallery.sksat.net. This is a separate Qwik/QwikCity project under `admin/` with its own `package.json`, `node_modules`, and Cloudflare Pages deployment. Read alongside the root [CLAUDE.md](../CLAUDE.md) — workflow rules, fixture conventions, and VRT baseline policy are inherited from there.

## Differences from the root project

- **Dev port**: `5175` (root uses `5174` for Playwright). Avoids conflicts when both projects' dev servers are running.
- **Routing**: Currently a single `/` dashboard (`src/routes/index.tsx`). No fixture data needed yet.
- **Auth**: Production is behind Cloudflare Access. Local dev has no auth — `pnpm dev` serves the dashboard at `http://localhost:5175` (use `pnpm start` if you want it to auto-open in a browser).
- **Bindings**: D1 `DB` (metadata source of truth, see [migrations/](migrations/)). R2 (Phase 3+) and image upload (Phase 4) are not wired yet. Tests run against a real local D1 (sequenced via `e2e/start-test-server.sh` so wrangler dev opens the file *after* seeding).
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

- `e2e/smoke.spec.ts` — minimum: `/` returns 200 and renders the dashboard heading
- `e2e/vrt/*.vrt.spec.ts` — visual baseline of admin screens (currently dashboard only)
- `src/**/*.spec.ts` — pure-function unit tests (none yet; add as logic accumulates)

VRT baselines must be regenerated on Linux/Chromium (CI) — same rule as the root project.
