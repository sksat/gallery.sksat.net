import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { listMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import { platformParam } from "~/lib/format";
import { isVisibility } from "~/lib/types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Lenient: invalid input (non-integer, below `min`) silently falls back to
// `fallback` rather than 4xx — admin-only API, ergonomic over strict.
// Values above `max` are clamped, not rejected.
const parseIntParam = (
  v: string | null,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) return fallback;
  return Math.min(n, max);
};

export const onGet: RequestHandler = withErrorHandler(
  "GET /api/media",
  async ({ platform, url, json }) => {
    const db = getDB(platform);
    const limit = parseIntParam(
      url.searchParams.get("limit"),
      DEFAULT_LIMIT,
      1,
      MAX_LIMIT,
    );
    const offset = parseIntParam(
      url.searchParams.get("offset"),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    // ?platform=
    const platformFilter = platformParam(url.searchParams) ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const v = url.searchParams.get("visibility");
    const visibility = isVisibility(v) ? v : undefined;

    const result = await listMedia(db, {
      platform: platformFilter,
      visibility,
      q,
      limit,
      offset,
    });
    json(200, { ...result, limit, offset });
  },
);
