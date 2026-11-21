import type { RequestHandler } from "@builder.io/qwik-city";
import { cardWantedKey } from "@shared/resized/resized";
import { getDB, getMediaCache } from "~/lib/env";
import { e2eRoutesEnabled } from "~/lib/e2e-routes";

// E2E only: POST /e2e/resized/?id=<n> puts a photo back to waiting for its
// resized copies (as a change of the file it shows would), so a spec can
// watch the background maker fill a photo it did not upload; with
// `&card=1` it instead asks for the photo's `og` card again, as the image
// Worker does when the card's caption is no longer the photo's. 404 unless
// the E2E server's E2E_TEST_ROUTES=1 binding is set and the request is on
// a loopback host.
export const onPost: RequestHandler = async ({ platform, url, json }) => {
  const env = (platform as { env?: Record<string, unknown> } | undefined)?.env;
  if (!e2eRoutesEnabled(env, url)) {
    json(404, { error: "not found" });
    return;
  }
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    json(400, { error: "invalid id" });
    return;
  }
  const db = getDB(platform);
  if (url.searchParams.has("card")) {
    const row = await db
      .prepare("SELECT public_id FROM media WHERE id = ?")
      .bind(id)
      .first<{ public_id: string }>();
    const bucket = getMediaCache(platform);
    if (!row || !bucket) {
      json(404, { error: "no such photo or bucket" });
      return;
    }
    await bucket.put(cardWantedKey(row.public_id), new Uint8Array());
    json(200, { ok: true });
    return;
  }
  await db
    .prepare("UPDATE media SET resized_at = NULL WHERE id = ?")
    .bind(id)
    .run();
  json(200, { ok: true });
};
