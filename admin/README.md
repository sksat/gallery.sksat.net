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

Currently, no environment variables are required for Phase 0.

Future phases will require:

- D1 database binding
- R2 bucket binding
- Environment-specific configuration

## Next Steps

- [ ] Phase 1: D1 database integration and migration
- [ ] Phase 2: Metadata management UI (view, edit, delete)
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
