# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a photo/image gallery web application built with **Qwik** and **QwikCity**, designed for deployment on **Cloudflare Pages**. It displays photos from two categories: "Real" (real-world photos) and "VRChat" (VRChat screenshots). Images are served from an S3-compatible storage, with metadata managed via `media.json`.

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
- **Dynamic routes**: `/photo/[imageId]/` for individual photo viewing
- **Path alias**: `~/` maps to `./src/` (configured in tsconfig.json)

### Core Components

**Gallery Component** (`src/components/gallery/gallery.tsx`)

- Main UI component managing photo display and navigation
- Fetches `media.json` index from S3 via `VITE_S3_BASE_URL` environment variable
- State management: tag filter (AND/OR; `world` is treated as one more tag, see `tags.ts`), selected image overlay
- Keyboard navigation: Arrow keys to browse within the filtered photos when an image is selected
- URL history: the filter lives in the query (`?tag=a&tag=b&mode=or`, replaceState); selecting an image pushes `/photo/[imageId]?<same query>`

**Media Data Flow**

1. `media.json` contains array of `MediaInfo` objects with metadata (file path, world, timestamp, camera, tags)
2. Images stored in `media/` directory, organized by category (VRChat/, 2023-12-comsys2023/)
3. In production: served from S3 bucket; in dev: served from local `media/` folder

### Environment Configuration

- `.env.local`: Development (local media serving)
- `.env.production`: Production (S3 base URL)
- Required variable: `VITE_S3_BASE_URL` - base URL for media assets

### Deployment (Cloudflare Pages)

- Adapter: `@builder.io/qwik-city/adapters/cloudflare-pages`
- Entry point: `src/entry.cloudflare-pages.tsx`
- Build config: `adapters/cloudflare-pages/vite.config.ts`
- Output: `dist/` directory
- Routing: Auto-generated `_routes.json` for SSR/static file handling
- Build watch paths (set in the Cloudflare dashboard, not in the repo): `gallery-sksat-net` skips pushes that only touch `admin/*`, and `admin-gallery-sksat-net` builds only when `admin/*` changes. The two apps must stay independent: if admin ever imports files outside `admin/` (or the gallery imports from `admin/`), update these watch paths too, or a change to the shared file will not redeploy the other app.

### Image Worker (`workers/image/`)

- Serves resized photos at `gallery.sksat.net/img/<preset>/<file>`. The Worker shell and that route are managed by Terraform outside this repo; do not add `routes` to `workers/image/wrangler.jsonc`. It fetches the original from B2 with `cf.image`, so Cloudflare Image Transformations does the resize; the Worker itself cannot decode the 8K PNGs within 128MB / 10ms CPU (Free plan).
- Only the presets in `workers/image/src/request.ts` exist. Each distinct (file, preset) counts toward the free tier of 5,000 unique transformations per month; past it, new ones fail with error 9422 (no charge). Do not add a preset per call site — reuse the existing ones.
- The `og` preset is the social card (og:image, built in `src/components/ogp.ts`): a 1200×630 JPEG crop with `public/og-badge.png` drawn on top via `cf.image.draw`. The badge text is baked into the PNG (no text rendering in the Worker); regenerate it with `workers/image/og-badge.sh`.
- Deployed from `main` by `.github/workflows/deploy-image-worker.yaml` with a Workers Scripts:Edit-only token (repo secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_APP_DEPLOY_TOKEN`). Manual deploy: `pnpm run deploy.image`.

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

- E2E and VRT both read `public/test-media/media.json` via `VITE_S3_BASE_URL=http://127.0.0.1:5174/test-media/` (set in `playwright.config.ts`). Never point tests at the production S3 URL.
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

- Do not edit `media.json` (the production index, not the fixture). It is synced from S3 out-of-band.
- Do not bypass git hooks (`--no-verify`, `--no-gpg-sign`).
- Do not blindly accept snapshot updates. Open the diff first and confirm the change is intentional.

> **Future work**: [mizchi/vrt](https://github.com/mizchi/vrt) (multi-layer pixel + computed-style + a11y diff with AI-driven CSS fix suggestions) is the longer-term VRT target. It currently requires Node 24+ and pnpm-based source build, so this repo uses Playwright `toHaveScreenshot` until upstream ships a runnable npm release.
