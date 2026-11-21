import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getDB, getMediaCache } from "~/lib/env";
import {
  checkResizedItems,
  failResized,
  MAX_RESIZED_BYTES,
  storeResized,
} from "~/lib/resized";
import { CARD_PRESETS, RESIZED_PRESET_NAMES } from "@shared/resized/resized";

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The resized copies the browser made of a claimed photo
 * (src/lib/resized.ts): multipart/form-data with `claim`, `source` (the
 * media_file id they were made from), `manifest` (JSON: preset, width,
 * height, sameAs, type of each) and one file per preset with an image of
 * its own, named by its preset: the six copies, the `og-site` card and,
 * with `caption` (JSON, the caption drawn), the `og` card. Stored in the
 * MEDIA_CACHE bucket, then the
 * photo is marked made. Or JSON `{ claim, failed: true }`: the browser
 * could not make them (tried again in a day).
 *
 * 200 { ok: true, stored, removed } or { ok: false } (the claim is gone:
 * nothing stored); 400 a bad post; 503 no bucket.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/resized/[id]",
  async ({ platform, params, request, json }) => {
    const id = parseId(params.id);
    if (id === null) {
      json(400, { error: "invalid id" });
      return;
    }
    const bucket = getMediaCache(platform);
    if (!bucket) {
      json(503, { error: "the MEDIA_CACHE bucket is not bound" });
      return;
    }
    const db = getDB(platform);
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        claim?: unknown;
        failed?: unknown;
      } | null;
      if (typeof body?.claim !== "string" || body.failed !== true) {
        json(400, { error: "expected { claim, failed: true }" });
        return;
      }
      json(200, { ok: await failResized(db, id, body.claim) });
      return;
    }
    // Six small images at most: well under the request body limit.
    const length = Number(request.headers.get("content-length") ?? NaN);
    if (
      length >
      (RESIZED_PRESET_NAMES.length + CARD_PRESETS.length) * MAX_RESIZED_BYTES
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
    const claim = form.get("claim");
    const source = Number(form.get("source"));
    let manifest: unknown;
    try {
      manifest = JSON.parse(String(form.get("manifest")));
    } catch {
      manifest = null;
    }
    if (typeof claim !== "string" || !Number.isInteger(source)) {
      json(400, { error: "claim and source are required" });
      return;
    }
    const files = new Map<string, Uint8Array>();
    for (const preset of [...RESIZED_PRESET_NAMES, ...CARD_PRESETS]) {
      const f = form.get(preset);
      if (f && typeof f !== "string") {
        files.set(preset, new Uint8Array(await f.arrayBuffer()));
      }
    }
    let caption: unknown = null;
    try {
      caption = JSON.parse(String(form.get("caption") ?? "null"));
    } catch {
      caption = null;
    }
    const items = checkResizedItems(manifest, files, caption);
    if (typeof items === "string") {
      json(400, { error: items });
      return;
    }
    json(
      200,
      await storeResized(db, bucket, {
        id,
        claim,
        sourceFileId: source,
        items,
      }),
    );
  },
);
