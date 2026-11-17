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

| Var                    | Where            | Used by                                         |
| ---------------------- | ---------------- | ----------------------------------------------- |
| `B2_REGION`            | `vars`           | publish                                         |
| `B2_BUCKET`            | `vars`           | publish                                         |
| `B2_ENDPOINT`          | `vars`           | publish                                         |
| `B2_ACCESS_KEY_ID`     | secret/.dev.vars | publish                                         |
| `B2_SECRET_ACCESS_KEY` | secret/.dev.vars | publish                                         |
| `IMAGE_BASE_URL`       | `vars`           | thumbnails (image Worker; empty = placeholders) |

Bindings:

- `DB` — D1 database `gallery-admin` (metadata source of truth)

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

Once seeded, the `/media` page lists every row, `/media/[id]` edits `world`, `camera_make`, `camera_model`, and `tags`, and the dashboard's **Publish** button regenerates `media.json` from D1 and PUTs it to the B2 bucket.

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
