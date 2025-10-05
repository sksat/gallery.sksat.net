# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a photo/image gallery web application built with **Qwik** and **QwikCity**, designed for deployment on **Cloudflare Pages**. It displays photos from two categories: "Real" (real-world photos) and "VRChat" (VRChat screenshots). Images are served from an S3-compatible storage, with metadata managed via `media.json`.

## Essential Commands

### Development

```bash
npm start          # Start dev server with SSR (opens browser)
npm run dev        # Start dev server without opening browser
npm run dev.debug  # Start dev server with Node inspector for debugging
```

### Building

```bash
npm run build             # Full production build (client + server + types)
npm run build.client      # Build client only
npm run build.server      # Build Cloudflare Pages server adapter
npm run build.types       # Type check only (no emit)
```

### Preview & Deployment

```bash
npm run preview    # Preview production build locally
npm run serve      # Preview with Wrangler (Cloudflare Pages simulation)
npm run deploy     # Deploy to Cloudflare Pages
```

### Code Quality

```bash
npm run lint       # ESLint on src/**/*.ts*
npm run fmt        # Format code with Prettier
npm run fmt.check  # Check formatting
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
- State management: world selection (Real/VRChat), selected image overlay
- Keyboard navigation: Arrow keys to browse when image selected
- URL history: Updates route when selecting images (`/photo/[imageId]`)

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

### Styling

- **Tailwind CSS** configured (scans `src/**/*.{js,ts,jsx,tsx,mdx}`)
- **CSS Modules** for component-specific styles (e.g., `gallery.module.css`)
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
- Node.js >= 15.0.0 required
