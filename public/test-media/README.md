# Test Media Fixture

Deterministic fixture used by E2E (`e2e/*.spec.ts`) and VRT (`e2e/vrt/*.vrt.spec.ts`).

In tests, `playwright.config.ts` sets `VITE_S3_BASE_URL=http://127.0.0.1:5174/test-media/`, so the dev server reads `media.json` from this directory and serves the PNGs under `mock/`.

## Inventory

`media.json` defines five entries with fixed timestamps. Indices match the `imageId` used in `/photo/[imageId]` routes (0-indexed by position in the array).

| imageId | file                | world  | timestamp              | camera (slug)                    | tags          |
| ------- | ------------------- | ------ | ---------------------- | -------------------------------- | ------------- |
| 0       | `/mock/real1.png`   | Real   | `2023-12-01T00:00:00Z` | `pentax-sp`                      | film          |
| 1       | `/mock/vrchat1.png` | VRChat | `2023-12-02T00:00:00Z` | `virtuallens2`                   | VRChat        |
| 2       | `/mock/real2.png`   | Real   | `2023-12-03T00:00:00Z` | —                                | night         |
| 3       | `/mock/vrchat2.png` | VRChat | `2023-12-04T00:00:00Z` | —                                | VRChat, night |
| 4       | `/mock/vrchat3.png` | VRChat | `2023-12-05T00:00:00Z` | `virtuallens2` (make/model only) | VRChat        |

The gallery treats `world` as one more tag, so the tag counts are **VRChat 3**, **Real 2**, **night 2**, **film 1**. `e2e/gallery.spec.ts` relies on these, e.g. `Real` AND `night` = photo 2, `Real` OR `night` = photos 0, 2, 3.

Photos 0 and 1 use the camera format the admin publishes (`{make, model, slug, name}`). Photo 4 keeps the older `{make, model}` shape, so its slug is derived from the model (`virtuallens2`) — the camera page for VirtualLens2 lists photos 1 and 4.

`cameras.json` (published by the admin next to `media.json`) has two cameras:

| slug           | name         | kind    | manufacturer (url) / model            | description / productUrl       | images                                    |
| -------------- | ------------ | ------- | ------------------------------------- | ------------------------------ | ----------------------------------------- |
| `pentax-sp`    | PENTAX SP    | film    | Asahi / Pentax SP                     | —                              | —                                         |
| `virtuallens2` | VirtualLens2 | virtual | logilabo (example.com) / VirtualLens2 | two-line text, example.com URL | `camera/virtuallens2/{front,ui,side}.png` |

On the camera list (`/camera/`) VirtualLens2 comes first (2 photos, cover = its first picture), then PENTAX SP (1 photo, no pictures, so the cover is photo 0).

The camera images under `camera/<slug>/` (the same key convention the admin uses for the bucket) are tiny gradients (80x60 / 60x80) made with ImageMagick (`-strip`, no date chunks, so they are byte-stable). `e2e/camera.spec.ts` and `e2e/vrt/camera.vrt.spec.ts` rely on these.

## Rules when modifying

- Use fixed ISO-8601 timestamps (`2023-12-XX`). Never `new Date().toISOString()`.
- Keep PNG dimensions small (current files are tiny gradients) — VRT baselines need to be cheap to diff.
- After changing this fixture, expect both E2E counts and VRT baselines to need updates.
- The order of the array is the `imageId`. Do not reorder without updating tests that reference specific IDs.
