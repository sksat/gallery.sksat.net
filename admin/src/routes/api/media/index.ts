import type { RequestHandler } from "@builder.io/qwik-city";
import { listMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import type { MediaWorld } from "~/lib/types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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

const parseWorld = (v: string | null): MediaWorld | undefined =>
  v === "Real" || v === "VRChat" ? v : undefined;

export const onGet: RequestHandler = async ({ platform, url, json }) => {
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
  const world = parseWorld(url.searchParams.get("world"));
  const q = url.searchParams.get("q") ?? undefined;

  const result = await listMedia(db, { world, q, limit, offset });
  json(200, { ...result, limit, offset });
};
