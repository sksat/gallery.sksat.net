# CLAUDE.md (admin)

Admin panel for gallery.sksat.net. This is a separate Qwik/QwikCity project under `admin/` with its own `package.json`, `node_modules`, and Cloudflare Pages deployment. Read alongside the root [CLAUDE.md](../CLAUDE.md) — workflow rules, fixture conventions, and VRT baseline policy are inherited from there.

## Differences from the root project

- **Dev port**: `5175` (root uses `5174` for Playwright). Avoids conflicts when both projects' dev servers are running.
- **Routing**: Currently a single `/` dashboard (`src/routes/index.tsx`). No fixture data needed yet.
- **Auth**: Production is behind Cloudflare Access, and every SSR/API request (static assets under `/build/*` etc. are served without it) is additionally checked by `src/routes/plugin@access.ts` (verifies the `Cf-Access-Jwt-Assertion` JWT against `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`; fails closed). This matters because the production `*.pages.dev` hostname is not covered by Access. The check is skipped only under `pnpm dev` (Vite) and when `ACCESS_DISABLED=1` is bound on a loopback hostname (`.dev.vars` for `pnpm serve`, `e2e/start-test-server.sh` for E2E). If you add an Access application, append its AUD tag to `ACCESS_AUD`.
- **Bindings**: D1 `DB` (metadata source of truth, see [migrations/](migrations/)). Bindings come from `wrangler.jsonc` only (Pages ignores dashboard bindings because `pages_build_output_dir` is set): top-level = production + local, `env.preview` = previews with **no D1** and only the preview Access AUD. R2 (Phase 3+) and image upload (Phase 4) are not wired yet. Tests run against a real local D1 (sequenced via `e2e/start-test-server.sh` so wrangler dev opens the file _after_ seeding).
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
pnpm run deploy      # wrangler pages deploy ./dist --project-name admin-gallery-sksat-net (normally Git integration deploys instead)

# D1 lifecycle (see README.md for the full flow)
pnpm db.migrate.local
pnpm import-media && pnpm db.seed.local
```

## Test layout

- `e2e/smoke.spec.ts` — `/` returns 200 and renders the dashboard heading
- `e2e/access.spec.ts` — the Access JWT check is wired in (hits a second server on PORT+1 started without the bypass; expects 403)
- `e2e/media-list.spec.ts`, `e2e/media-edit.spec.ts` — `/media` flows
- `e2e/vrt/*.vrt.spec.ts` — visual baselines (`/`, `/media` at 1280px and 390px, `/media/2`)
- `src/**/*.spec.ts` — pure-function unit tests (`db.ts`, `validate.ts`, `format.ts`)

`POST /api/publish` has no E2E coverage on purpose: a faithful test would have to mock SigV4 + the B2 round-trip. Verify manually after deploy until B2 secrets land in CI.

VRT baselines must be regenerated inside the Playwright Docker image — `admin-e2e` in [.github/workflows/ci.yaml](../.github/workflows/ci.yaml) runs the same image (`mcr.microsoft.com/playwright:v1.65.1-noble`) so baselines generated outside it drift in sub-pixel font rendering. Use the docker invocation from the root [CLAUDE.md](../CLAUDE.md) (substitute `podman` for `docker` if not in the docker group). Keep the image tag in sync with `@playwright/test` in `package.json`.

## Styling

Tailwind CSS v4 via `@tailwindcss/vite` (same setup as the root project); base styles in `src/global.css`. Use utilities only — no CSS modules or UI libraries. Shared class strings live in `src/components/ui.ts`, error/empty states use `StatePanel` (`src/components/state-panel.tsx`). Theme: the header toggle cycles system / light / dark, stored in `localStorage` (`admin-theme`) and mirrored on `<html data-theme>` by an inline `<head>` script before first paint (`src/lib/theme.ts`). The `dark:` variant is redefined in `global.css` to follow that attribute, and `prefers-color-scheme` when it is `system`.
