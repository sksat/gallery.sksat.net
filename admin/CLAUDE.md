# CLAUDE.md (admin)

The admin app for gallery.sksat.net: a separate Qwik City project on Pages with its own `package.json`, deployed to admin.gallery.sksat.net. It owns the D1 schema (`migrations/`) and is the only writer of D1. Read the root [CLAUDE.md](../CLAUDE.md) first: its hard rules, limits, test and VRT rules apply here too.

## Production, bindings and auth

- Bindings come only from `wrangler.jsonc`. Top level is production and local; `env.preview` deliberately has no D1, no `IMAGES` service binding, no R2 and no B2 upload secrets, because previews run unreviewed code. Do not give previews production bindings.
- `pnpm dev` (Vite) has no D1. Use `pnpm run build && pnpm serve` (wrangler pages dev, local D1 and R2) for anything that reads data.
- Production is behind Cloudflare Access, but the production `*.pages.dev` hostname is not covered by it. `src/routes/plugin@access.ts` therefore verifies the `Cf-Access-Jwt-Assertion` JWT on every SSR and API request and fails closed. The bypass (`ACCESS_DISABLED=1`) works only on a loopback hostname; keep it that way.
- Thumbnails of private photos come from the image Worker's `AdminImage` RPC through the `IMAGES` binding, which verifies the same Access JWT itself. Responses stay `Cache-Control: private`; never put them in a shared cache.
- The B2 upload key has writeFiles only (no readFiles). Deleting objects (完全に削除, a deleted incomplete upload's display copy) needs listFiles and deleteFiles, which the code supports but the key does not have yet: until they are added, B2 answers 403 and the admin says 「削除の権限がありません」. Reads of the bucket (checking an upload, reading metadata, fetching an original) go through `AdminImage` (`stat`, `bytes`, `object`). Do not add read permission to the admin's key. The image Worker method a change needs must be deployed before the admin code that calls it.
- The browser uploads originals straight to B2 with presigned PUTs; the admin only signs. The bucket's CORS rule for this (origin `https://admin.gallery.sksat.net`, `s3_put`, headers `content-type` and `x-amz-meta-sha256`, expose `ETag`) is set with `b2_update_bucket`, outside the repo.
- `/api/favicon/<host>/` fetches a referrer site's favicon itself (`src/lib/favicon.ts`): https only, public host names only (`isPublicHostname`), redirects checked hop by hop, a time limit, a size cap and raster images by their bytes only. Keep those checks when changing it; never route favicons through a third-party service or let the browser fetch them from the site.
- Cloudflare Analytics needs the optional secret `CF_ANALYTICS_API_TOKEN` (Account Analytics: Read). Without it the dashboard cards say so and the page still renders. All Analytics queries go through `cachedGraphql` (5-min Cache API, never throws).
- The edit page's world card reads the world's page and picture from VRChat itself (`/api/world/<id>`, `src/lib/world-preview.ts`, the parser in `shared/vrchat/`), kept in `caches.default` by world id (a world's public page, nothing of the photo). `VRCHAT_ORIGIN` points it elsewhere (E2E: the fake bucket).

## Data invariants

- `media.public_id` is set once and never changes (public URLs). `media.file` and `media_file.object_key` are B2 keys and never change; moving or renaming changes only `media.path`. Triggers enforce these; a migration that rebuilds `media` must recreate its triggers.
- Every action that changes what the public API answers must bump the content version: `contentChanged` (`src/lib/last-good.ts`) after the write, or `contentVersionStatement` inside the same D1 batch. Undo actions too. Writing resized copies to R2 changes no API answer and needs no bump.
- The public metadata levels in `src/lib/metadata.ts` are a copy of `workers/api/src/metadata.ts` (a test checks they match). The API Worker's `projectPhoto` is what decides what is public.
- Only `ready` rows that are not in the trash are photos (`LIVE_PHOTO` in `src/lib/types.ts`).
- Bump `PHOTO_META_PARSER_DATE` (`src/lib/photo-meta.ts`) when the metadata parser learns something, and `RESIZED_DATE` (`shared/resized/claim.ts`) when resized copies must be made again. No migration is needed for either.

## D1 rows read (Free plan: 5M per day)

- Every `<Link>` sets `prefetch="js"` (`src/lib/link-prefetch.spec.ts` checks it). Qwik City's default prefetch runs all of the target page's loaders whenever a link becomes visible or is hovered.
- A new frequent query needs an index. Write `LIVE_PHOTO` terms exactly as in the partial indexes (`migrations/0007_list_indexes.sql`), or the index does not match. SQLite does not split an OR over a partial index; use one statement per term.
- D1 counts every element of an `IN (SELECT value FROM json_each(?))` list and every probe for it; look up many candidate names as a range instead.
- Check plans and rows read on a local D1 with `pnpm tsx scripts/bench-queries.ts`; several specs assert query plans.

## Image presets

`src/lib/images.ts` mirrors the image Worker's presets. Each distinct (file, preset) counts toward the monthly transformation quota, so do not add presets here.

## Qwik gotchas

- Qwik City's `Link` keeps the href it was first rendered with while the route stays the same. On pages that navigate in place (e.g. `/media` filters), key such links by their href.
- A component that uses `usePlatformList` must read `.value` in every render, or the list may not reach the browser.

## Tests

- E2E runs against a real local D1 seeded from `e2e/fixture.sql`, started by `e2e/start-test-server.sh` (which seeds before wrangler opens the file), with fakes on loopback for B2 (`e2e/fake-b2.mjs`) and the GraphQL API (`e2e/fake-graphql.mjs`). Never point tests at production.
- The fixture marks every photo's metadata read and its copies made, so the background reader and resize maker stay idle unless a test uploads.
- E2E runs serially on one shared D1, and many specs assert counts of fixture rows. A spec that adds rows should work in its own folders (`e2e/files-helpers.ts`) or clean up after itself. The Firefox project needs `pnpm exec playwright install firefox`.
- CI runs the spec groups in `playwright.config.ts` (`ADMIN_E2E_GROUP`) as separate jobs, each on a fresh D1; a spec not listed falls into `rest`. Rebalance the groups from the CI job times when one gets much longer than the others.
- Test servers run side by side need `ADMIN_E2E_PORT`s at least 10 apart (each uses its port to +3, and +4000 / +4001).
- VRT baselines: run the Docker command from the root CLAUDE.md in `admin/` (CI's `admin-e2e` job uses the same image).
