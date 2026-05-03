# CLAUDE.md (admin)

Admin panel for gallery.sksat.net. This is a separate Qwik/QwikCity project under `admin/` with its own `package.json`, `node_modules`, and Cloudflare Pages deployment. Read alongside the root [CLAUDE.md](../CLAUDE.md) — workflow rules, fixture conventions, and VRT baseline policy are inherited from there.

## Differences from the root project

- **Dev port**: `5175` (root uses `5174` for Playwright). Avoids conflicts when both projects' dev servers are running.
- **Routing**: Currently a single `/` dashboard (`src/routes/index.tsx`). No fixture data needed yet.
- **Auth**: Production is behind Cloudflare Access. Local dev has no auth — `pnpm dev` serves the dashboard at `http://localhost:5175` (use `pnpm start` if you want it to auto-open in a browser).
- **Future bindings (Phase 1+)**: D1 (metadata DB) and R2 (media storage). When these land, mock at the `platform.env` boundary in tests rather than hitting real bindings.

## Commands

```bash
cd admin
pnpm install
pnpm dev             # http://localhost:5175 (no Cloudflare Access)
pnpm run build.types # tsc --noEmit
pnpm test            # Vitest
pnpm run test.e2e    # Playwright E2E (e2e/*.spec.ts)
pnpm run test.vrt    # Playwright VRT (e2e/vrt/*.vrt.spec.ts)
pnpm run test.vrt.update
pnpm run build       # qwik build
pnpm run deploy      # wrangler pages publish ./dist
```

## Test layout

- `e2e/smoke.spec.ts` — minimum: `/` returns 200 and renders the dashboard heading
- `e2e/vrt/*.vrt.spec.ts` — visual baseline of admin screens (currently dashboard only)
- `src/**/*.spec.ts` — pure-function unit tests (none yet; add as logic accumulates)

VRT baselines must be regenerated on Linux/Chromium (CI) — same rule as the root project.
