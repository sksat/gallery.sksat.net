# Gallery Admin Panel

Admin panel for [gallery.sksat.net](https://gallery.sksat.net), protected by Cloudflare Access.

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm start

# Build for production
pnpm run build

# Preview production build
pnpm serve
```

## Deployment to Cloudflare Pages

### Prerequisites

- Cloudflare account with access to the `sksat.net` zone
- Wrangler CLI installed (`pnpm add -g wrangler`)

### Step 1: Create Cloudflare Pages Project

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. Select the repository: `sksat/gallery.sksat.net`
4. Configure build settings:
   - **Project name**: `gallery-admin` (or your preferred name)
   - **Production branch**: `main`
   - **Framework preset**: None
   - **Build command**: `pnpm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `admin`

### Step 2: Configure Custom Domain

1. In the Pages project dashboard, go to **Custom domains** tab
2. Click **Set up a custom domain**
3. Enter: `admin.gallery.sksat.net`
4. Click **Continue**
5. If the zone is already managed by Cloudflare, the CNAME record will be added automatically

### Step 3: Set up Cloudflare Access

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Zero Trust** → **Access** → **Applications**
3. Click **Add an application** → **Self-hosted**
4. Configure the application:
   - **Application name**: Gallery Admin
   - **Session Duration**: 24 hours (or your preference)
   - **Application domain**:
     - Subdomain: `admin`
     - Domain: `gallery.sksat.net`
5. Click **Next**
6. Configure policy:
   - **Policy name**: Admin Access
   - **Action**: Allow
   - **Include**: Add rules (e.g., Emails ending in `@yourdomain.com`, or specific email addresses)
7. Click **Next** → **Add application**

### Step 4: Verify Deployment

1. Visit `https://admin.gallery.sksat.net`
2. You should see the Cloudflare Access authentication screen
3. After authenticating, you should see the Admin Dashboard page

### Step 5: Verify Main Site is Still Public

1. Visit `https://gallery.sksat.net`
2. Verify it's still publicly accessible without authentication

## Manual Deployment (using Wrangler)

```bash
# Build the project
pnpm run build

# Deploy to Cloudflare Pages
pnpm run deploy
```

Note: Manual deployment requires Wrangler to be authenticated with your Cloudflare account:

```bash
wrangler login
```

## Project Structure

```
admin/
├── adapters/
│   └── cloudflare-pages/
│       └── vite.config.ts        # Cloudflare Pages adapter config
├── public/
│   └── manifest.json
├── src/
│   ├── routes/
│   │   ├── index.tsx              # Admin Dashboard page
│   │   └── layout.tsx             # Root layout
│   ├── entry.cloudflare-pages.tsx # Cloudflare Pages entry point
│   ├── entry.dev.tsx              # Development entry point
│   ├── entry.preview.tsx          # Preview entry point
│   ├── entry.ssr.tsx              # SSR entry point
│   └── root.tsx                   # Root component
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Environment Variables

Configured in `wrangler.jsonc` (`vars`) for non-secret values, and via `wrangler pages secret put <NAME> --project-name admin-gallery-sksat-net --env production` (or `.dev.vars` locally — see `.dev.vars.example`) for credentials. Set B2 secrets for **production only**: preview deployments run unreviewed code (e.g. Renovate PRs) and must not be able to write to the bucket.

| Var                    | Where            | Used by                                             |
| ---------------------- | ---------------- | --------------------------------------------------- |
| `B2_REGION`            | `vars`           | publish                                             |
| `B2_BUCKET`            | `vars`           | publish                                             |
| `B2_ENDPOINT`          | `vars`           | publish                                             |
| `B2_ACCESS_KEY_ID`     | secret/.dev.vars | publish                                             |
| `B2_SECRET_ACCESS_KEY` | secret/.dev.vars | publish                                             |
| `THUMBNAILS`           | `vars`           | `1` = thumbnails via `/thumb`; empty = placeholders |

Bindings:

- `DB` — D1 database `gallery-admin` (metadata source of truth)
- `IMAGES` — the image Worker's `AdminImage` entrypoint (service `gallery-image`), for `/thumb/<preset>/<file>`. Deploy the image Worker with that entrypoint before the admin, or the Pages deploy fails.

## D1 setup (Phase 1)

The metadata that backs `media.json` lives in a D1 database. Production rollout:

```bash
# 1. Create the D1 database (one-time) and put the printed database_id in
#    wrangler.jsonc (top-level `d1_databases`). It is committed: Pages reads
#    bindings from wrangler.jsonc, not the dashboard, and the id is not a
#    credential. Preview deployments (`env.preview`) intentionally have no D1.
pnpm db.create

# 2. (already done for gallery-admin: 70d6bc59-9937-48e0-90bb-0ef8a2a53bcd)
#    Local D1 state is keyed by database_id: data you seeded while the id was
#    the all-zero placeholder is no longer used — re-run the local steps below.

# 3. Apply schema migrations.
pnpm db.migrate.remote   # production
pnpm db.migrate.local    # local miniflare-backed D1

# 4. Initial import from the existing media.json (one-shot).
pnpm import-media        # writes migrations/seeds/0001_seed.sql from ../media/media.json
pnpm db.seed.remote      # apply to production
pnpm db.seed.local       # apply to local
```

Once seeded, the `/media` page lists every row, `/media/[id]` edits `world`, the camera, and `tags`, `/camera` registers cameras (name, slug, kind, manufacturer and its website, model, product page URL, description, and pictures of the camera itself), and the dashboard's **Publish** button regenerates `cameras.json` and `media.json` from D1 and PUTs them to the B2 bucket.

> **Migration `0002_camera.sql`** creates `camera` and `camera_image`, makes one camera per distinct `(camera_make, camera_model)` pair already in `media` (named after the model with the make as its `manufacturer`; slug from the model, e.g. `virtuallens2`; kind `virtual` when only VRChat photos use it), points `media.camera_id` at it, and rebuilds `media` without the old `camera_make`/`camera_model` columns. Review the generated names/slugs in `/camera` after `pnpm db.migrate.remote`. `pnpm import-media` emits cameras the same way.

> **Migration `0003_visibility.sql`** adds `visibility` (`private` / `unlisted` / `public`; existing rows that are in the production media.json become `public`, other existing rows and new rows are `private`), a random `public_id` per photo for public URLs, and `legacy_index` (each photo's position in the production media.json when the migration was written, for redirecting old `/photo/<N>` URLs). `pnpm import-media` imports photos as `public` with a fresh `public_id` but no `legacy_index` (only the migration sets it, for rows already in D1). Change visibility on a photo's edit page, or tick several rows on `/media` and use **Set visibility of selected**. Only `public` photos are written to media.json on Publish.

> **Camera pictures** (`camera_image`, several per camera, ordered) are referenced by bucket path, by convention `/camera/<slug>/<name>.png`, e.g. `/camera/virtuallens2/front.png` (png/jpg/jpeg, `[A-Za-z0-9._-]` segments; the prefix is only a convention, nothing depends on it). The admin has no upload yet: **upload the file to the B2 bucket by hand first**, then add its path on the camera's edit page. Thumbnails and the public page only use the image Worker presets, never the original.

> **Prerequisite before first Publish**: enable Object Lock / file versioning on the B2 bucket. Publish overwrites the entire `media.json` from a single D1 SELECT — there is no diff or dry-run, so a corrupted D1 (failed seed, partial import, accidental DELETE) would otherwise destructively replace the live index. Versioning gives a one-click rollback.

> **Access JWT check**: `src/routes/plugin@access.ts` rejects any request without a valid Cloudflare Access JWT (`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`). It is what protects the production `admin-gallery-sksat-net.pages.dev` hostname, which no Access application covers. Local `pnpm serve` needs `ACCESS_DISABLED=1` in `.dev.vars` (see `.dev.vars.example`).
>
> **Dev caveat**: `pnpm serve` (and the test server in `e2e/start-test-server.sh`) binds locally with no auth because `ACCESS_DISABLED=1` is set (honoured only on `localhost` / `127.0.0.1`) — Cloudflare Access only fronts production. Do not expose the dev port (5175 / 8788) on a public network interface; CSRF is the only thing keeping a malicious page from POSTing to your local D1.

> **No publish concurrency guard**: there is no server-side in-flight lock on `/api/publish`. Two simultaneous publishes (e.g. double-click, two tabs) issue independent D1 SELECTs and B2 PUTs — whichever PUT finishes last wins. Single-admin use makes this low risk; if the admin gets multi-user, add an in-flight flag (or a `429`) in `api/publish/index.ts`.

## Next Steps

- [x] Phase 1: D1 database integration and migration
- [x] Phase 2: Metadata management UI (view, edit) — delete deferred
- [ ] Phase 3: R2 storage integration
- [ ] Phase 4: Image upload functionality

## Troubleshooting

### Build fails

Check Node.js version:

```bash
node --version  # Should be >= 20.19.0
```

### Deployment fails

Ensure you're authenticated with Wrangler:

```bash
wrangler whoami
```

### Custom domain not resolving

1. Verify DNS propagation: `dig admin.gallery.sksat.net`
2. Check Cloudflare Pages dashboard for CNAME record
3. Wait for DNS propagation (can take up to 24 hours)

### Cloudflare Access not working

1. Verify the application is configured for `admin.gallery.sksat.net`
2. Check that the policy includes your email/identity
3. Try clearing cookies and re-authenticating
