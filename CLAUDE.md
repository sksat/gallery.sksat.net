# CLAUDE.md

Photo gallery for gallery.sksat.net on Cloudflare. This repo holds four deployables and their shared code:

- `src/`: the public gallery (Qwik City on Pages). It reads everything through the API Worker.
- `workers/api/`: read-only JSON API over the admin's D1 (`/api/*`, plus RPC methods for the image Worker).
- `workers/image/`: serves resized photos and og cards at `/img/*`, and the admin's thumbnails over RPC (`AdminImage`).
- `admin/`: the admin app, a separate pnpm project that owns the D1 schema (`admin/migrations/`). See [admin/CLAUDE.md](admin/CLAUDE.md).
- `shared/`: code used by both apps (`@shared/*`). Keep it plain TS: a Qwik component there would resolve the root's Qwik from the admin and could bundle two copies. The gallery never imports from `admin/`, nor the admin from `src/`.

How they connect: [docs/architecture.d2](docs/architecture.d2) (rendered as `docs/architecture.svg`; re-render with `d2 --layout elk docs/architecture.d2 docs/architecture.svg` when bindings change).

## Motivation and design intent

- A personal gallery of photos: taken in the real world, scanned from film and other analog originals, and taken in VRChat and other virtual platforms. They are all photos; do not call the VRChat ones screenshots.
- The owner decides, per photo, whether it is shown at all (private by default) and how much of its metadata is public (the place and the scanner are hidden by default). Publishing too much is the failure that cannot be undone, so every public path goes through one projection and private data fails closed.
- It should run at near zero cost on Cloudflare's free tiers for years while the library grows. Costs that scale with the number of photos every month (e.g. transforming every photo again each month) are design bugs; prefer doing work once and storing the result. When a choice has a cost, show the estimate (a chart in the PR) before deciding.
- D1 is the single source of truth, written only by the admin; the public side only reads, through the API Worker. There is no publish step: a change is live within about a minute.
- The admin is a tool the owner uses on a phone as much as on a desktop, often for batches of photos.

## How we work

- Make the UI intuitive by following common conventions (a desktop file manager's selection, undo in a toast) rather than adding explanatory text or modes. Every change can be undone; prefer undo to confirmation dialogs, except for deletions that cannot be undone.
- Error messages state a cause only when the code knows it; otherwise keep them short and neutral, followed by what the user can do.
- Keep compatibility shims (old URL forms, aliases) only as long as a deploy needs them, except redirects for links that were shared.
- Names in URLs, tables and API paths are singular (`camera`, `photo`; `media` is a mass noun).
- UI text is Japanese and written plainly: 「デフォルト」 rather than 「既定」, no coined terms.
- Keep this file to what the code does not tell you: intent, rules and outside constraints. Do not add descriptions of how features work; the code and its tests say that.

## Hard rules

- Do not write to the production D1 or apply migrations to it from a dev session. The admin is the only writer, and migrations are applied on purpose by the owner.
- Do not bypass git hooks (`--no-verify`, `--no-gpg-sign`).
- Do not blindly accept snapshot updates. Open the diff and confirm the change is intended.
- Never point tests at the production API, B2 or S3 URLs.

## Things the code does not tell you

### Owned outside this repo

- Worker shells, their routes (`gallery.sksat.net/api/*`, `/img/*`) and the R2 bucket are managed by external Terraform. Never add `routes` to a Worker's `wrangler.jsonc` (cron `triggers` may live there).
- Pages build watch paths are set in the Cloudflare dashboard: the gallery project skips pushes that only touch `admin/*`; the admin project builds only when `admin/*` or `shared/*` changes. If you add another directory both apps import, it must be added to the admin's watch paths too.
- Pages bindings come only from each `wrangler.jsonc` (with `pages_build_output_dir` set, dashboard bindings are ignored).
- `main` is protected: changes land through PRs with passing CI. The Workers deploy from `main` via `.github/workflows/deploy-*-worker.yaml`; the Pages projects deploy through the Git integration.

### Deploy ordering

- A migration must be applied to production D1 before any code that reads its columns is merged, since the admin and both Workers deploy automatically from `main` and nothing applies migrations for you. The API Worker's queries read admin tables directly (`workers/api/src/query.ts`).
- A Worker RPC method or binding target must be deployed before the code that calls it (e.g. a new `AdminImage` method before the admin uses it).

### Cloudflare Free plan limits (the design follows from these)

- **D1: 5M rows read per day.** Every row or index entry a query visits counts. The API Worker therefore keeps every answer in the Cache API per content version (`workers/api/src/last-good.ts`) and reads D1 only after the admin bumps the `setting` row `content_version`. Any admin write that changes what the API answers must bump it (`contentChanged`, or `contentVersionStatement` inside the same batch).
- **Workers: 10 ms CPU, 128 MB, 50 subrequests.** The image Worker never decodes images: resizing is done by Image Transformations (`cf.image`), EXIF is inserted by editing the container only, and bodies are streamed.
- **Image Transformations: 5,000 unique transformations per month**, then error 9422. Only the presets in `workers/image/src/request.ts` exist; never add one per call site. Resized copies are made once and stored in R2 (`shared/resized/`) so they are not counted again each month. Transformations are cached and counted by source URL and `cf.cacheKey` is Enterprise-only, so the presigned B2 GET URL is kept stable over a 6-day window (`workers/image/src/origin.ts`); do not sign per request.

### Privacy invariants

- Which metadata of a photo is public is decided in one place, `projectPhoto` (`workers/api/src/query.ts`, levels in `metadata.ts`; the admin has a copy checked by a test). Served images get EXIF built only from that projection; never pass an original's metadata through.
- Private photos, unfinished uploads and trashed photos never leave the API Worker or the public `/img/*` handler. Unlisted photos open only by their own URL and never join a list.
- Private photos must never enter a shared cache: `AdminImage` (reachable only through the admin's `IMAGES` service binding, and it verifies the Access JWT itself) never uses `caches.default`, and its file fallback (`X-Image-Fallback: original`) exists only there.
- The B2 bucket is private. Only the image Worker reads originals (read-only key); the admin only signs the browser's uploads and deletes objects.
- If an Access application is added to the admin, add its AUD to `ACCESS_AUD` in both `admin/wrangler.jsonc` and `workers/image/wrangler.jsonc`.

### External services

- Map tiles come from OpenFreeMap (no key, no limit). Never use OpenStreetMap's own tile servers: their usage policy does not cover an app's map. MapLibre GL JS is loaded only from the map components' visible tasks.

## Tooling

- pnpm 12, pinned by `packageManager` (root and `admin/`); with a different major, run `npx -y pnpm@<version>`. Settings live in `pnpm-workspace.yaml`.
- `minimumReleaseAge` is 4320 in both `pnpm-workspace.yaml` files and in `renovate.json`; keep the three in sync. If an install fails on a just-released version, wait; never lower it or exclude the package.

## Tests

- Preferred loop: a failing test first, then the minimal change. Pre-commit hooks are intentionally not configured.
- Pure logic goes in `*.spec.ts` next to it (Vitest; `shared/` and `workers/` tests run in the root Vitest). User flows go in `e2e/*.spec.ts`, look in `e2e/vrt/*.vrt.spec.ts`.
- E2E and VRT read photos from a local API Worker on a D1 seeded with the admin migrations and `e2e/fixture.sql` (`e2e/start-api-server.sh`), and images from `public/test-media/`. The map style is a local stub, and the map E2E fails on any request that leaves 127.0.0.1.
- Fixture timestamps are fixed strings. Do not call `Date.now()`, `Math.random()` or external `fetch` from code under test without injection.
- For dynamic content in VRT, use `mask` rather than disabling the assertion.

### VRT baselines

Baselines are platform-sensitive (sub-pixel font rendering). Always regenerate them in the Playwright Docker image that CI uses, never on the host:

```bash
docker run --rm -it \
  -v "$(pwd):/work" -w /work \
  -e CI=true \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -c "npm install -g \"\$(node -p 'require(\"./package.json\").packageManager')\" && pnpm install --frozen-lockfile && pnpm run test.vrt.update"
```

Keep the image tag in sync with `@playwright/test` in `package.json` (root and `admin/`). Use `podman` if you are not in the docker group. On a CI failure, download the `vrt-diff` artifact.
