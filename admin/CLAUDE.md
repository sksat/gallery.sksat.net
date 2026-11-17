# CLAUDE.md (admin)

Admin panel for gallery.sksat.net. This is a separate Qwik/QwikCity project under `admin/` with its own `package.json`, `node_modules`, and Cloudflare Pages deployment. Read alongside the root [CLAUDE.md](../CLAUDE.md) — workflow rules, fixture conventions, and VRT baseline policy are inherited from there.

## Differences from the root project

- **Dev port**: `5175` (root uses `5174` for Playwright). Avoids conflicts when both projects' dev servers are running.
- **Routing**: `/` dashboard, `/media/` + `/media/[id]/` (photo metadata), `/camera/` + `/camera/new/` + `/camera/[id]/` (camera records; route paths are singular, except the mass noun `/media/`). E2E/VRT data comes from `e2e/fixture.sql`. Links from the list to an edit page carry the list URL in `?back=` (`mediaEditHref` / `safeBackHref` in `src/lib/format.ts`); the edit page's "← Media" returns there and its ‹ 前へ / 次へ › step through that list (`src/lib/neighbors.ts`). Its unsaved-changes guard uses `usePreventNavigate$`, which is experimental and enabled in `vite.config.ts`.
- **Cameras**: table names are singular (`camera`, `camera_image`; `media` is a mass noun). A photo links to at most one `camera` row via `media.camera_id` (migration `0002_camera.sql`, which replaced the old free-text `camera_make`/`camera_model` columns). The camera row is the single source of truth: it has `manufacturer` / `manufacturer_url` (kept on the camera for now; a `manufacturer` table once several cameras share one) and `model`. Cameras have no delete yet; the FK has no `ON DELETE`, so a camera with photos cannot be removed by SQL either. Pictures of a camera live in `camera_image` (`ON DELETE CASCADE`, ordered by `position`, unique per camera + file); `file` is a bucket path validated by `validateImageFile`. There is no upload, so the file is placed in B2 by hand.
- **Visibility and public ids** (migration `0003_visibility.sql`): `media.visibility` is `private` (default for new rows; admin only), `unlisted` (opens by URL, never listed) or `public`. `media.public_id` is the photo's id in public URLs (`/photo/<public_id>/`): 10 symbols from `23456789abcdefghjkmnpqrstuvwxyz`, set once at creation and never changed (triggers fill it in when an INSERT leaves it out and reject any change; a migration that rebuilds `media` must recreate them). App code generates it with `generatePublicId()` (`src/lib/public-id.ts`, `crypto.getRandomValues`); the trigger's `random()` is only a fallback for raw SQL. `media.legacy_index` freezes each photo's position in the production media.json at the time of the migration (the `N` of old `/photo/<N>` URLs) and is never written by the app. Visibility is set on the edit page or in bulk from `/media` (tick rows → Apply; at most one page, 100 ids; on phones a selection bar fixed at the bottom). The bulk action returns each changed row's previous visibility, and the toast's 「元に戻す」 sends it back through `useRestoreVisibility`. The API lists only `public` rows.
- **Auth**: Production is behind Cloudflare Access, and every SSR/API request (static assets under `/build/*` etc. are served without it) is additionally checked by `src/routes/plugin@access.ts` (verifies the `Cf-Access-Jwt-Assertion` JWT against `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`; fails closed). This matters because the production `*.pages.dev` hostname is not covered by Access. The check is skipped only under `pnpm dev` (Vite) and when `ACCESS_DISABLED=1` is bound on a loopback hostname (`.dev.vars` for `pnpm serve`, `e2e/start-test-server.sh` for E2E). If you add an Access application, append its AUD tag to `ACCESS_AUD`.
- **Bindings**: D1 `DB` (metadata source of truth, see [migrations/](migrations/)). Bindings come from `wrangler.jsonc` only (Pages ignores dashboard bindings because `pages_build_output_dir` is set): top-level = production + local, `env.preview` = previews with **no D1** and only the preview Access AUD. R2 (Phase 3+) and image upload (Phase 4) are not wired yet. Tests run against a real local D1 (sequenced via `e2e/start-test-server.sh` so wrangler dev opens the file _after_ seeding).
- **Thumbnails**: every thumbnail and preview (public or not, and camera pictures) is `/thumb/<preset>/<file>` (`src/routes/thumb/`), which calls the image Worker's `AdminImage` RPC entrypoint through the `IMAGES` service binding (`wrangler.jsonc`, production only: previews run unreviewed code, so they get neither D1 nor this binding and show placeholders), passing on the request's `Cf-Access-Jwt-Assertion`; the Worker verifies that JWT itself, so both the binding and a valid Access token are required. Responses are `Cache-Control: private`. `src/lib/images.ts` mirrors the Worker's preset list — only those presets exist, and each distinct file+preset counts toward the monthly transform quota, so do not add presets here. With `THUMBNAILS` empty (E2E sets `--binding THUMBNAILS=`) or no binding, `Thumb` renders a deterministic placeholder; the originals (up to ~37MB) are never loaded.
- **No publish step**: the public site reads D1 through the API Worker (`workers/api`, read-only, cached for about a minute), so a saved edit is live once that cache expires. The admin never writes to B2.

## Commands

```bash
cd admin
pnpm install
pnpm dev             # http://localhost:5175 (vite dev — D1 binding NOT wired here)
pnpm serve           # wrangler pages dev (D1 binding wired; use this for /media, /camera, /api)
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
- `e2e/media-files.spec.ts` — the Files view (`/media/?view=files&dir=…`)
- `e2e/media-visibility.spec.ts` — visibility badge/filter, edit-page change, bulk change
- `e2e/camera.spec.ts` — camera list / create / edit / images and picking a camera on a photo
- `e2e/csrf-protection.spec.ts`, `e2e/theme.spec.ts` — Origin checks on mutating requests; the theme toggle
- `e2e/mobile-*.spec.ts` — phone flows (390×844, `isMobile`, `hasTouch`): text size, tap targets, busy buttons and toasts; bulk selection and undo; the edit page's save bar, prev/next and unsaved-changes guard
- `e2e/vrt/*.vrt.spec.ts` — visual baselines (`/`, `/camera` at 1280px; `/media`, the Files view, `/media/2` and `/camera/1` at 1280px and 390px)
- `src/**/*.spec.ts` — pure-function unit tests (`db.ts`, `db-files.ts`, `folders.ts`, `validate.ts`, `format.ts`, `progress.ts`, `images.ts`, `theme.ts`, `access.ts`, `public-id.ts`), plus `migrations.spec.ts`, which runs the D1 migrations on an in-memory `node:sqlite`, and `neighbors.spec.ts`, which runs the edit page's prev/next query there

VRT baselines must be regenerated inside the Playwright Docker image — `admin-e2e` in [.github/workflows/ci.yaml](../.github/workflows/ci.yaml) runs the same image (`mcr.microsoft.com/playwright:v1.65.1-noble`) so baselines generated outside it drift in sub-pixel font rendering. Use the docker invocation from the root [CLAUDE.md](../CLAUDE.md) (substitute `podman` for `docker` if not in the docker group). Keep the image tag in sync with `@playwright/test` in `package.json`.

## Styling

Tailwind CSS v4 via `@tailwindcss/vite` (same setup as the root project); base styles in `src/global.css`. Use utilities only — no CSS modules or UI libraries. Shared class strings live in `src/components/ui.ts`, error/empty states use `StatePanel` (`src/components/state-panel.tsx`). Phones come first: below `sm`, tap targets are at least 44px (`h-11`) and form controls use 16px text (no iOS zoom on focus; never set `maximum-scale`). Every action button is a `SubmitButton` (`src/components/submit-button.tsx`: disabled with a spinner while `action.isRunning`, the form gets `aria-busy`), and action results go to the page's `Toast` (`src/components/toast.tsx`), not inline text that can be scrolled off screen. Theme: the header toggle cycles system / light / dark, stored in `localStorage` (`admin-theme`) and mirrored on `<html data-theme>` by an inline `<head>` script before first paint (`src/lib/theme.ts`). The `dark:` variant is redefined in `global.css` to follow that attribute, and `prefers-color-scheme` when it is `system`.
