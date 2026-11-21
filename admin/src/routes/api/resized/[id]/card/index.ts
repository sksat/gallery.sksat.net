import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getDB, getMediaCache } from "~/lib/env";
import { MAX_RESIZED_BYTES, parseCardCaption, storeCard } from "~/lib/resized";

/**
 * An `og` card the browser drew again (POST /api/resized/card):
 * multipart/form-data with `source` (the media_file id the photo's copies
 * were made from), `caption` (JSON, the caption drawn) and `og` (the JPEG).
 *
 * 200 { ok } (false: the photo is resized from another file now; nothing
 * stored); 400 a bad post; 503 no bucket.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/resized/[id]/card",
  async ({ platform, params, request, json }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      json(400, { error: "invalid id" });
      return;
    }
    const bucket = getMediaCache(platform);
    if (!bucket) {
      json(503, { error: "the MEDIA_CACHE bucket is not bound" });
      return;
    }
    if (
      Number(request.headers.get("content-length") ?? 0) > MAX_RESIZED_BYTES
    ) {
      json(400, { error: "too large" });
      return;
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      json(400, { error: "expected multipart/form-data" });
      return;
    }
    const source = Number(form.get("source"));
    let caption = null;
    try {
      caption = parseCardCaption(JSON.parse(String(form.get("caption"))));
    } catch {
      caption = null;
    }
    const card = form.get("og");
    const bytes =
      card && typeof card !== "string"
        ? new Uint8Array(await card.arrayBuffer())
        : null;
    if (
      !Number.isInteger(source) ||
      !caption ||
      !bytes ||
      bytes.length < 3 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff
    ) {
      json(400, { error: "source, caption and a JPEG og are required" });
      return;
    }
    json(200, {
      ok: await storeCard(getDB(platform), bucket, {
        id,
        sourceFileId: source,
        caption,
        bytes,
      }),
    });
  },
);
