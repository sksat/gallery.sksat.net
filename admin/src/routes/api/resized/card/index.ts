import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getCaptionOf } from "~/lib/card-caption";
import { getDB, getMediaCache } from "~/lib/env";
import { resizeMaker, wantedCards } from "~/lib/resized";

/**
 * The `og` cards the image Worker asked for (src/lib/resized.ts
 * wantedCards: their caption changed since they were made, or they were
 * never made), with the caption to draw. The browser draws each from the
 * photo's stored w3840 copy and posts it to /api/resized/<id>/card.
 *
 * Body `{ cursor? }`: the page of requests after the one that gave it.
 *
 * 200 { cards: WantedCard[], cursor: string | null }; 503 no bucket or
 * nothing to ask the caption of.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/resized/card",
  async ({ platform, request, url, json }) => {
    const bucket = getMediaCache(platform);
    const captionOf = getCaptionOf(
      platform,
      url,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!bucket || !captionOf) {
      json(503, { error: "no bucket or caption source" });
      return;
    }
    const db = getDB(platform);
    // The image Worker's cron answers them unless the site makes its
    // copies in the browser; then only the ones it could not draw.
    const onlyForBrowser = (await resizeMaker(db)) !== "browser";
    const body = (await request.json().catch(() => null)) as {
      cursor?: unknown;
    } | null;
    const cursor =
      typeof body?.cursor === "string" && body.cursor.length <= 1024
        ? body.cursor
        : undefined;
    json(
      200,
      await wantedCards(db, bucket, captionOf, { cursor, onlyForBrowser }),
    );
  },
);
