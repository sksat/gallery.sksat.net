# Test Media Fixture

Deterministic fixture used by E2E (`e2e/*.spec.ts`) and VRT (`e2e/vrt/*.vrt.spec.ts`).

In tests, `playwright.config.ts` sets `VITE_S3_BASE_URL=http://127.0.0.1:5174/test-media/`, so the dev server reads `media.json` from this directory and serves the PNGs under `mock/`.

## Inventory

`media.json` defines five entries with fixed timestamps. Indices match the `imageId` used in `/photo/[imageId]` routes (0-indexed by position in the array).

| imageId | file                | world  | timestamp              | camera                  | tags          |
| ------- | ------------------- | ------ | ---------------------- | ----------------------- | ------------- |
| 0       | `/mock/real1.png`   | Real   | `2023-12-01T00:00:00Z` | —                       | film          |
| 1       | `/mock/vrchat1.png` | VRChat | `2023-12-02T00:00:00Z` | logilabo / VirtualLens2 | VRChat        |
| 2       | `/mock/real2.png`   | Real   | `2023-12-03T00:00:00Z` | —                       | night         |
| 3       | `/mock/vrchat2.png` | VRChat | `2023-12-04T00:00:00Z` | —                       | VRChat, night |
| 4       | `/mock/vrchat3.png` | VRChat | `2023-12-05T00:00:00Z` | —                       | VRChat        |

The gallery treats `world` as one more tag, so the tag counts are **VRChat 3**, **Real 2**, **night 2**, **film 1**. `e2e/gallery.spec.ts` relies on these, e.g. `Real` AND `night` = photo 2, `Real` OR `night` = photos 0, 2, 3.

## Rules when modifying

- Use fixed ISO-8601 timestamps (`2023-12-XX`). Never `new Date().toISOString()`.
- Keep PNG dimensions small (current files are tiny gradients) — VRT baselines need to be cheap to diff.
- After changing this fixture, expect both E2E counts and VRT baselines to need updates.
- The order of the array is the `imageId`. Do not reorder without updating tests that reference specific IDs.
