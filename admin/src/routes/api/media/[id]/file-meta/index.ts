import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getDB } from "~/lib/env";
import { getObjectBytes } from "~/lib/object-bytes";
import { readRawMeta } from "~/lib/raw-meta";

/**
 * Everything in a photo file's metadata (raw-meta.ts), read from the
 * original when asked and never stored: the edit page's
 * ファイルのメタデータ.
 *
 * `?file=<bucket key>` names which of the photo's files; for now a photo
 * has one, `media.file`, which is also the default. Any other key is 404,
 * so this reads only files that belong to the photo.
 *
 * 200 RawMeta, 404 no such photo or file, 503 nothing to read with.
 * Never cached outside the browser (private photos).
 */
export const onGet: RequestHandler = withErrorHandler(
  "GET /api/media/[id]/file-meta",
  async ({ platform, params, request, url, headers, json }) => {
    headers.set("Cache-Control", "private, no-store");
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      json(400, { error: "invalid id" });
      return;
    }
    const row = await getDB(platform)
      .prepare("SELECT file FROM media WHERE id = ?")
      .bind(id)
      .first<{ file: string }>();
    const file = url.searchParams.get("file") ?? row?.file;
    if (!row || file !== row.file) {
      json(404, { error: "not found" });
      return;
    }
    const read = getObjectBytes(
      platform,
      url,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!read) {
      json(503, { error: "the image Worker is not bound" });
      return;
    }
    const meta = await readRawMeta((range) => read(file, range));
    if (!meta) {
      json(404, { error: "the file is not in the bucket" });
      return;
    }
    json(200, { file, ...meta });
  },
);
