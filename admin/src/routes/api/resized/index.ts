import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getCaptionOf } from "~/lib/card-caption";
import { MAX_BULK_IDS } from "~/lib/db";
import { getDB, getMediaCache } from "~/lib/env";
import { claimResized } from "~/lib/resized";

/**
 * Claim photos whose resized copies the browser makes next
 * (src/lib/resized.ts; src/components/resize-maker.tsx calls it): `{ ids }`
 * the photos it just uploaded (it has their files), or `{}` any waiting.
 * One indexed, LIMIT-ed claim per call: no count of what is left.
 *
 * 200 { photos: ClaimedPhoto[], more } — call again while `more`.
 * 400 bad ids; 503 no bucket to store the copies in (previews).
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/resized",
  async ({ platform, request, url, json }) => {
    if (!getMediaCache(platform)) {
      json(503, { error: "the MEDIA_CACHE bucket is not bound" });
      return;
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      json(400, { error: "invalid JSON" });
      return;
    }
    const raw = (body as { ids?: unknown } | null)?.ids;
    let ids: number[] | undefined;
    if (raw !== undefined) {
      if (
        !Array.isArray(raw) ||
        raw.length === 0 ||
        raw.length > MAX_BULK_IDS ||
        !raw.every((n) => Number.isInteger(n) && n > 0)
      ) {
        json(400, { error: "invalid ids" });
        return;
      }
      ids = raw as number[];
    }
    // Each photo's `og` caption, asked of the image Worker (card-caption.ts);
    // without it only the badge-only card is made.
    const captionOf =
      getCaptionOf(
        platform,
        url,
        request.headers.get("cf-access-jwt-assertion"),
      ) ?? undefined;
    json(
      200,
      await claimResized(
        getDB(platform),
        ids ? { ids, limit: ids.length, captionOf } : { captionOf },
      ),
    );
  },
);
