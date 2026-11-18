import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { backfillBatch, countUnread } from "~/lib/backfill";
import { getDB } from "~/lib/env";
import { getObjectBytes } from "~/lib/object-bytes";

/**
 * Read the metadata of the next few photos not read yet (backfill.ts).
 * Body: { after } (0 to start; then the previous answer's `next`).
 *
 * 200 { read, found, failed, next, remaining } — call again with `next`
 *     until it is null. 503 when the image Worker is not bound.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/metadata/backfill",
  async ({ platform, request, json }) => {
    const read = getObjectBytes(
      platform,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!read) {
      json(503, { error: "the image Worker is not bound" });
      return;
    }
    const body = (await request.json().catch(() => null)) as {
      after?: unknown;
    } | null;
    const after = body?.after ?? 0;
    if (
      typeof after !== "number" ||
      !Number.isSafeInteger(after) ||
      after < 0
    ) {
      json(400, { error: "after must be a non-negative integer" });
      return;
    }
    const db = getDB(platform);
    const result = await backfillBatch(db, read, after);
    json(200, { ...result, remaining: await countUnread(db) });
  },
);
