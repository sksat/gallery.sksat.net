# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a photo/image gallery web application built with **Qwik** and **QwikCity**, designed for deployment on **Cloudflare Pages**. It displays photos from two categories: "Real" (real-world photos) and "VRChat" (VRChat screenshots). Images are served from an S3-compatible storage (resized by the image Worker); metadata lives in the admin's D1 and is read through the API Worker.

## Essential Commands

This project uses **pnpm** 12 as the package manager (pinned via `packageManager` in `package.json`; `admin/` pins the same version). If your `pnpm` is a different major, run it as `npx -y pnpm@<that version>`. pnpm settings live in `pnpm-workspace.yaml` (root and `admin/` each have one), not in `package.json`. pnpm refuses packages published less than a day ago (`minimumReleaseAge`, the pnpm 12 default); if an install fails on a just-released version, wait rather than lowering it.

### Development

```bash
pnpm start          # Start dev server with SSR (opens browser)
pnpm dev            # Start dev server without opening browser
pnpm run dev.debug  # Start dev server with Node inspector for debugging
```

### Building

```bash
pnpm run build             # Full production build (client + server + types)
pnpm run build.client      # Build client only
pnpm run build.server      # Build Cloudflare Pages server adapter
pnpm run build.types       # Type check only (no emit)
```

### Preview & Deployment

```bash
pnpm preview    # Preview production build locally
pnpm serve      # Preview with Wrangler (Cloudflare Pages simulation)
pnpm deploy     # Deploy to Cloudflare Pages
```

### Code Quality

```bash
pnpm lint       # ESLint on src/**/*.ts*
pnpm fmt        # Format code with Prettier
pnpm run fmt.check  # Check formatting
```

### Testing

```bash
pnpm test                # Vitest watch mode (pure functions in src/**/*.spec.ts)
pnpm run test.coverage   # Vitest with coverage report
pnpm run test.e2e        # Playwright E2E (e2e/*.spec.ts)
pnpm run test.vrt        # Visual regression (e2e/vrt/*.vrt.spec.ts, toHaveScreenshot)
pnpm run test.vrt.update # Regenerate VRT baselines (commit the diff)
```

## Architecture

### Routing & File Structure

- **File-based routing**: Routes defined in `src/routes/` directory
- **Layout system**: `src/routes/layout.tsx` provides shared layout (Header/Footer) with caching configuration
- **Dynamic routes**: `/photo/[imageId]/` for individual photo viewing (`imageId` is the photo's public id; old numeric URLs are gone), `/camera/` (list of cameras with photos) and `/camera/[slug]/` for a camera's details and its photos (route paths are singular; see `src/components/gallery/cameras.ts`)
- **Path alias**: `~/` maps to `./src/` (configured in tsconfig.json)

### Core Components

**Gallery Component** (`src/components/gallery/gallery.tsx`)

- Main UI component managing photo display and navigation
- Reads the photo and camera lists from `useGalleryIndex` (the layout's route loader, which asks the API Worker; `src/lib/api.ts`)
- State management: tag filter (AND/OR; `platform` (Real / VRChat, the API's former `world`) is treated as one more tag, see `tags.ts`), selected image overlay
- Keyboard navigation: Arrow keys to browse within the filtered photos when an image is selected
- URL history: the filter lives in the query (`?tag=a&tag=b&mode=or`, replaceState); selecting an image pushes `/photo/[imageId]?<same query>`. On a camera page the same Gallery runs with a camera filter; a photo opened there carries `?camera=<slug>` so closing it returns to `/camera/<slug>/`
- Visibility: lists contain public photos only. An unlisted photo is passed in by its `/photo/<id>` route and shown in the overlay, but never joins the grid, the tag counts, the sort or the arrow-key order. Private photos are 404.

**Media Data Flow**

1. The admin's D1 (`gallery-admin`) is the source of truth; the API Worker (`workers/api`) serves `/api/media`, `/api/media/<public_id>`, `/api/camera`, `/api/camera/<slug>`
2. Route loaders reach it through the Pages service binding `API` (root `wrangler.jsonc`), or `VITE_API_BASE_URL` without one (dev, tests)
3. Images are addressed by public id at the image Worker (`/img/<public_id>?size=<preset>`); without `VITE_IMAGE_BASE_URL` (dev, tests) the originals under `VITE_S3_BASE_URL` are used

### Environment Configuration

- `.env.local`: Development (local media serving; the production API by default)
- `.env.production`: Production (S3, image Worker and API base URLs)
- Variables: `VITE_S3_BASE_URL` (originals), `VITE_IMAGE_BASE_URL` (image Worker; optional), `VITE_API_BASE_URL` (API Worker, when there is no `API` binding)
- Root `wrangler.jsonc` holds the Pages project's runtime bindings (`API` → `gallery-api`); with `pages_build_output_dir` set, Pages ignores bindings set in the dashboard

### Deployment (Cloudflare Pages)

- Adapter: `@builder.io/qwik-city/adapters/cloudflare-pages`
- Entry point: `src/entry.cloudflare-pages.tsx`
- Build config: `adapters/cloudflare-pages/vite.config.ts`
- Output: `dist/` directory
- Routing: Auto-generated `_routes.json` for SSR/static file handling
- Build watch paths (set in the Cloudflare dashboard, not in the repo): `gallery-sksat-net` skips pushes that only touch `admin/*`, and `admin-gallery-sksat-net` builds only when `admin/*` or `shared/*` changes.
- Shared code: code used by both the gallery and admin lives in `shared/` (imported as `@shared/*`, a tsconfig path in both apps; admin's Vite allows `../shared` in dev, and both apps' CSS has `@source` on it so Tailwind classes there are generated). Keep it plain TS (no Qwik components: a `.tsx` there would resolve the root's Qwik from admin and could bundle two copies). Its tests (`shared/**/*.spec.ts`) run in the root Vitest. Nothing else is shared: the gallery does not import from `admin/` nor admin from `src/`. If another shared directory is added, add it to the admin project's watch paths too, or a change there will not redeploy admin.
- `shared/overlay/`: the photo overlay's download-with-progress, preset choice and class strings, used by the gallery's `PhotoOverlay` and the admin's full-screen preview so both look and load the same.

### Image Worker (`workers/image/`)

- Serves resized photos at `gallery.sksat.net/img/<public_id>?size=<preset>`: it resolves the id through the API Worker (`API` service binding to `gallery-api`), so private photos get 404. `/img/<path>?size=<preset>` serves a public photo by its display path when its file name level is `path` (so it follows a move; the old path of a moved photo is 404) and a camera picture by its bucket path (the API's `pathAccess` RPC); unlisted and private photos are therefore not reachable through their guessable paths. Routing (`parseImageUrl`, `request.ts`): one segment of 10 public-id letters is an id, anything else must be a path with an image extension; `size` is optional (`w1200`) and the only query parameter (anything else, an unknown size or a card size on a path is 400); card sizes (`og`, `og-site`) only by id. The old `/img/<preset>/...` forms are gone (404). The edge cache keys on the bucket key, size, output format (and an `og` caption, or the digest of a resized photo's EXIF), so an id and a path share an entry; after a move or a level change, browsers may keep a copy for up to the 1 h `max-age`. The public `fetch` handler has no trusted-caller branch: the admin's thumbnails (private photos included) come from a separate named RPC entrypoint, `AdminImage.image(accessJwt, file, preset, accept)`, reachable only through a service binding that names it (the admin's `IMAGES`), and which itself verifies the admin request's Cloudflare Access JWT (`workers/image/src/admin-auth.ts`, `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` vars, same values as the admin's) before serving anything. The same entrypoint's `stat(accessJwt, file)` reads an original's first byte (a ranged GET with a timeout, not a HEAD, which hung in production; size from Content-Range, ETag, `x-amz-meta-sha256`; `workers/image/src/stat.ts`) so the admin can check an upload, whose own key is write-only. `bytes(accessJwt, file, range)` returns up to 256 KiB of an original (`{ offset, length }` or the last `{ suffix }` bytes; `workers/image/src/bytes.ts`) for the admin's metadata backfill. The Worker shell and that route are managed by Terraform outside this repo; do not add `routes` to `workers/image/wrangler.jsonc`. It fetches the original from B2 with `cf.image`, so Cloudflare Image Transformations does the resize; the Worker itself cannot decode the 8K PNGs within 128MB / 10ms CPU (Free plan).
- Originals: with the secrets `B2_KEY_ID` / `B2_APPLICATION_KEY` (a read-only B2 application key for the bucket) the Worker fetches them through S3 SigV4 presigned GET URLs (`workers/image/src/origin.ts`, `aws4fetch`), so the bucket can be private; without them it uses the public bucket URL (`ORIGIN_BASE_URL`). Image Transformations caches (and counts) resized images by source URL, and `cf.cacheKey` is Enterprise-only (ignored), so the presigned URL is kept stable: signed at the start of a 6-day window with a 7-day expiry. Do not sign per request. Each new window is a new source URL, so if unique transformations are counted by source URL, each (file, preset) can count up to ~6 times a month rather than once. Nothing else (gallery, admin) loads originals from B2 in production.
- Edge cache: a Worker response is never cached by the CDN, so the public handler stores its finished images in `caches.default` (`workers/image/src/cache.ts`), keyed by preset + file + negotiated format (+ caption for `og`), after the access check; `X-Image-Cache: HIT|MISS` tells which. Errors, failed transforms and captionless og cards are not stored. `AdminImage` never uses it (private photos must not enter a shared cache).
- Only the presets in `workers/image/src/request.ts` exist. Each distinct (file, preset) counts toward the free tier of 5,000 unique transformations per month; past it, new ones fail with error 9422 (no charge). Do not add a preset per call site — reuse the existing ones.
- The card presets make og:image (chosen in `src/components/ogp.ts`): a 1200×630 JPEG crop with `public/og-badge.png` drawn on top via `cf.image.draw`. `og` (photo pages) also draws the photo's date/camera/tags as `draw` text entries; the Worker gets the photo from the API (public and unlisted photos only) and builds the ASCII-only caption in `workers/image/src/caption.ts`. Cloudflare rasterizes the text, so the Worker itself does no text rendering. `og-site` (top page) has just the badge. Regenerate the badge, the caption shade and the font subset with `workers/image/og-assets.sh`.
- Resized photos carry the photo's public metadata as EXIF, and nothing else: Image Transformations strips the original's (`metadata: "none"`), then `src/public-exif.ts` builds tags from the API's projected photo (camera, time at its precision, exposure, rounded GPS, world name as ImageDescription; never Orientation) and `src/exif-embed.ts` inserts them by editing the container only (JPEG APP1; WebP → VP8X + EXIF chunk), without decoding pixels. AVIF is not edited, so a photo with any public EXIF is negotiated to WebP/JPEG. The edge cache keys on a digest of the EXIF; browsers may keep an older copy for its 1 h max-age. og cards get no EXIF.
- Deployed from `main` by `.github/workflows/deploy-image-worker.yaml` with a Workers Scripts:Edit-only token (repo secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_APP_DEPLOY_TOKEN`). Manual deploy: `pnpm run deploy.image`. If an Access application is added to the admin, add its AUD to `ACCESS_AUD` in both `admin/wrangler.jsonc` and `workers/image/wrangler.jsonc`.

### API Worker (`workers/api/`)

- Read-only JSON API over the admin's D1 database (`gallery-admin`), served at `gallery.sksat.net/api/*` (Worker shell `gallery-api` and route managed by Terraform outside this repo; no `routes` in `wrangler.jsonc`, `workers_dev = false`). The schema belongs to `admin/migrations`; this Worker only runs SELECTs.
- `GET /api/media` (public photos), `/api/media/<public_id>` (public or unlisted), `/api/camera`, `/api/camera/<slug>`. Private photos, photos whose upload has not completed (`status <> 'ready'`) and photos in the admin's trash (`trashed_at`) are never returned; these filters live in the SQL in `workers/api/src/query.ts`, so admin migrations (`0004_upload.sql`, `0005_path_trash.sql`) must be applied to D1 before this Worker is deployed. Cameras are listed only when a public photo uses them (opened by slug when a public or unlisted one does). Responses are cached for 60 s at the edge (Cache API, keyed by path) and 10 s in browsers.
- How much of each photo's metadata is public is decided in one place, `projectPhoto` (`workers/api/src/query.ts`, levels in `metadata.ts`): every field has ordered levels (file name `path` / `name` / `hidden`; taken at `second` … `year` / `hidden`, cut down in the photo's own offset, with `timestamp_precision`; camera `model` / `manufacturer` / `hidden`; tags `public` / `hidden`; location `exact` (5 decimals) / `city` / `prefecture` / `country` (only a position rounded to 2 / 1 / 0 decimals for now, no place name until reverse geocoding) / `hidden`, the default; world `link` (id + name, for https://vrchat.com/home/world/<id>) / `name` / `hidden`; exif `all` / `basic` (f_number, exposure_time, iso, focal_length_mm; the default) / `hidden`, from the normalized `media.exif` object, `ExifJSON` in `metadata.ts`; `media.world_author_id` is never returned). Each photo's `media.metadata_visibility` overrides the site default in the `setting` row `metadata_visibility`; an unknown value counts as hidden. Hidden fields are `null` (tags `[]`). Only tags marked public in the `tag` table are ever returned. `file` (the bucket key) is given only at `path` and while the photo has not been moved; `path` / `name` carry the display path and name. Cameras are listed or opened only through photos that show them at `model` (`levelSql`).
- Other Workers can call its RPC methods through a service binding (not reachable over HTTP): `pathAccess(path)` (what `/img/<path>` shows: a public photo whose display path it is and whose file name level is `path`, with its bucket key, or a camera picture by its bucket path) and `photo(publicId)` (a public or unlisted photo, projected, but with its bucket key in `file` so the image Worker can fetch the original).
- Tests: `workers/api/src/*.spec.ts` run the queries on node:sqlite with the admin migrations applied. Deployed from `main` by `.github/workflows/deploy-api-worker.yaml` (`pnpm run deploy.api`).

### Styling

- **Tailwind CSS** configured (scans `src/**/*.{js,ts,jsx,tsx,mdx}`)
- **CSS Modules** are not used for the gallery (Qwik SSR + Tailwind v4 issues); prefer Tailwind utilities
- Global styles in `src/routes/styles.css`

### Key Qwik Patterns

- **Server-side rendering (SSR)** by default
- **Resumability**: Uses `component$`, `$()`, and `useResource$` for optimal loading
- **Route loaders**: `routeLoader$()` for server-side data (see `layout.tsx`)
- **Request handlers**: `onGet` for cache control configuration

## Important Notes

- FlexSearch is imported but minimally used (placeholder implementation in `index.tsx`)
- Image overlay: Click outside image to close, arrow keys to navigate between images
- Caching strategy in layout: 5-second max-age, 7-day stale-while-revalidate
- TypeScript strict mode enabled
- Node.js >= 20.19.0 required (see `package.json` engines)

## Development Workflow

The default loop is **failing test → minimal implementation → green → refactor**. Recommended, not enforced — pre-commit hooks are intentionally not configured.

### Test layer selection

| What changed                                                  | Where to add the test                                   |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| Pure function (data transform, navigation logic, URL parsing) | `src/**/*.spec.ts` (Vitest)                             |
| User flow across components / routing / keyboard              | `e2e/*.spec.ts` (Playwright)                            |
| Visual layout / styling / regression of look                  | `e2e/vrt/*.vrt.spec.ts` (Playwright `toHaveScreenshot`) |

Pure functions live in `src/components/gallery/logic.ts`, `tags.ts` and `types.ts`. Add new pure logic there before reaching for component-level state — it keeps Vitest as the fast feedback loop.

### Fixture rules

- E2E and VRT read the photos from a local API Worker on a D1 seeded with the admin migrations and `e2e/fixture.sql` (`e2e/start-api-server.sh`, started by `playwright.config.ts`), and the images from `public/test-media/` via `VITE_S3_BASE_URL=http://127.0.0.1:5174/test-media/`. Never point tests at the production API or S3 URL.
- Fixture timestamps are fixed ISO strings (`2023-12-0X`). When adding a media entry, use a deterministic timestamp; do not use `new Date().toISOString()`.
- Do not call `Date.now()` / `Math.random()` / external `fetch` from code under test without injection — pass them as arguments or mock at the boundary.
- See [public/test-media/README.md](public/test-media/README.md) for the canonical fixture inventory.

### VRT baselines

Baselines are committed under `e2e/vrt/<spec>.ts-snapshots/` (Playwright's default path) and are platform-sensitive. **Always regenerate on Linux/Chromium** — running `npm run test.vrt.update` on macOS or arch-mismatched hosts produces baselines CI cannot match.

To regenerate locally, use the official Playwright Docker image (matches the CI runner):

```bash
docker run --rm -it \
  -v "$(pwd):/work" -w /work \
  -e CI=true \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -c "npm install -g \"\$(node -p 'require(\"./package.json\").packageManager')\" && pnpm install --frozen-lockfile && pnpm run test.vrt.update"
```

Keep the image tag in sync with `@playwright/test` in `package.json`. Then commit the regenerated PNGs.

- CI failure → download the `vrt-diff` artifact to inspect the diff PNG
- For dynamic content, use `mask: [page.locator(...)]` in the `toHaveScreenshot` call rather than disabling assertions

### chrome-devtools MCP usage

`.mcp.json` configures the chrome-devtools MCP server. Use it for the cases where automated tests are not enough:

1. Inspecting a VRT diff visually (`navigate_page` → `take_screenshot`)
2. Verifying CSS/layout changes that are not yet covered by VRT baselines
3. Checking console errors after a non-trivial frontend change (`list_console_messages`)

It is not a replacement for Vitest / Playwright — prefer adding a deterministic test when the failure mode is reproducible.

### Hard rules

- Do not write to the production D1 (`gallery-admin`) or apply migrations to it from a dev session; the admin is the only writer, and migrations are applied on purpose by the owner.
- Do not bypass git hooks (`--no-verify`, `--no-gpg-sign`).
- Do not blindly accept snapshot updates. Open the diff first and confirm the change is intentional.

> **Future work**: [mizchi/vrt](https://github.com/mizchi/vrt) (multi-layer pixel + computed-style + a11y diff with AI-driven CSS fix suggestions) is the longer-term VRT target. It currently requires Node 24+ and pnpm-based source build, so this repo uses Playwright `toHaveScreenshot` until upstream ships a runnable npm release.
