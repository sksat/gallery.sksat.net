# Test Media Fixture

Deterministic fixture used by E2E (`e2e/*.spec.ts`) and VRT (`e2e/vrt/*.vrt.spec.ts`).

The photo and camera metadata live in [`e2e/fixture.sql`](../../e2e/fixture.sql). `playwright.config.ts` starts the API Worker (`workers/api`) on a local D1 that has the admin's migrations and that file (`e2e/start-api-server.sh`, port 5178), and points the dev server at it with `VITE_API_BASE_URL`. `VITE_S3_BASE_URL=http://127.0.0.1:5174/test-media/` serves the images in this directory: the photos under `mock/` (the originals; the image Worker is not used in tests) and the camera pictures under `camera/`.

## Inventory

Seven photos with fixed timestamps and public ids.

| public id    | file                 | platform | timestamp                   | camera         | tags          | visibility |
| ------------ | -------------------- | -------- | --------------------------- | -------------- | ------------- | ---------- |
| `reaxxxxxxa` | `/mock/real1.png`    | Real     | `2023-12-01T00:00:00Z`      | `pentax-sp`    | film          | public     |
| `vrcxxxxxxa` | `/mock/vrchat1.png`  | VRChat   | `2023-12-02T00:00:00Z`      | `virtuallens2` | VRChat        | public     |
| `reaxxxxxxb` | `/mock/real2.png`    | Real     | `2023-12-03T00:00:00Z`      | —              | night         | public     |
| `vrcxxxxxxb` | `/mock/vrchat2.png`  | VRChat   | `2023-12-04T12:34:56+09:00` | —              | VRChat, night | public     |
| `vrcxxxxxxc` | `/mock/vrchat3.png`  | VRChat   | `2023-12-05T00:00:00Z`      | `virtuallens2` | VRChat, draft | public     |
| `unxxxxxxxx` | `/mock/unlisted.png` | VRChat   | `2023-12-06T00:00:00Z`      | `virtuallens2` | VRChat, night | unlisted   |
| `pvxxxxxxxx` | `/mock/private.png`  | Real     | `2023-12-07T00:00:00Z`      | —              | secret        | private    |

Metadata visibility (`media.metadata_visibility` over the site default, which hides file names): every file name is public with its folder except `reaxxxxxxb`'s, so the API leaves its `file` out and without the image Worker the gallery shows a grey stand-in for it; `vrcxxxxxxb` shows only the date it was taken (2023/12/04 in its +09:00). The tags film, VRChat and night are public; `draft` and `secret` are private and never returned.

For the overlay's info panel (`e2e/info-panel.spec.ts`) the fixture also covers each metadata level: `vrcxxxxxxa` shows everything (world with its link, every EXIF value, an exact location, which the panel leaves out until there is a map page); `vrcxxxxxxb` shows its camera's maker only (RICOH, camera 3) and the world name without a link, with EXIF hidden; `reaxxxxxxb` hides its camera (also camera 3) and shows the basic EXIF only; `reaxxxxxxa` shows the time to the minute. Camera 3 (`ricoh-gr3`) is never at the "model" level, so it has no page and is not in the camera list.

Only the five public photos are listed. The gallery treats `platform` as one more tag, so the tag counts are **VRChat 3**, **Real 2**, **night 2**, **film 1**. `e2e/gallery.spec.ts` relies on these, e.g. `Real` AND `night` = `reaxxxxxxb`, `Real` OR `night` = three photos. The unlisted and the private photo are the newest and carry tags of their own, so a leak into a list, a count or the top page's card shows up in the tests.

Two cameras:

| slug           | name         | kind    | manufacturer (url) / model            | description / productUrl       | images                                    |
| -------------- | ------------ | ------- | ------------------------------------- | ------------------------------ | ----------------------------------------- |
| `pentax-sp`    | PENTAX SP    | film    | Asahi / Pentax SP                     | —                              | —                                         |
| `virtuallens2` | VirtualLens2 | virtual | logilabo (example.com) / VirtualLens2 | two-line text, example.com URL | `camera/virtuallens2/{front,ui,side}.png` |

On the camera list (`/camera/`) VirtualLens2 comes first (2 public photos, cover = its first picture), then PENTAX SP (1 photo, no pictures, so the cover is `reaxxxxxxa`).

The camera images under `camera/<slug>/` (the same key convention the admin uses for the bucket) are tiny gradients (80x60 / 60x80) made with ImageMagick (`-strip`, no date chunks, so they are byte-stable). `e2e/camera.spec.ts` and `e2e/vrt/camera.vrt.spec.ts` rely on these.

## Rules when modifying

- Use fixed ISO-8601 timestamps (`2023-12-XX`). Never `new Date().toISOString()`.
- Public ids must match the admin's alphabet (`23456789abcdefghjkmnpqrstuvwxyz`, 10 symbols); the migration's CHECK rejects others.
- Keep PNG dimensions small (current files are tiny gradients) — VRT baselines need to be cheap to diff.
- After changing this fixture, expect both E2E counts and VRT baselines to need updates.
