import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { backfillAndPublish } from "~/lib/backfill";
import { getDB } from "~/lib/env";
import { getObjectBytes } from "~/lib/object-bytes";

/**
 * Read the next few photos waiting to be read (backfill.ts); the admin
 * pages call it on their own (src/components/metadata-reader.tsx). One
 * indexed, LIMIT-ed claim per call: no count of what is left.
 *
 * 200 { read, found, failed, more } — call again while `more`.
 * 503 when there is nothing to read with.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/metadata/backfill",
  async ({ platform, request, url, json }) => {
    const read = getObjectBytes(
      platform,
      url,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!read) {
      json(503, { error: "the image Worker is not bound" });
      return;
    }
    // Any row read may have got a timestamp or a device, even with no
    // other metadata: the content version follows (backfillAndPublish).
    json(200, await backfillAndPublish(getDB(platform), read));
  },
);
