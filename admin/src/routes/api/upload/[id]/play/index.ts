import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getVideoUpload, setPlayUploadId } from "~/lib/db-upload";
import { getDB, getMediaCache } from "~/lib/env";
import { isMultipart, planParts } from "~/lib/multipart";
import { r2Key } from "~/lib/video";

// The playback copy of a video upload goes into the R2 bucket through the
// admin's own binding (MEDIA_CACHE), not a presigned URL: R2 then needs no S3
// key in the admin and no CORS rule, and no credential that could write
// to it ever reaches a browser. Each request carries one part of at most
// 64 MiB (multipart.ts), under the 100 MB request body limit of Pages
// Functions.
//
//   PUT  /api/upload/<id>/play                   the whole copy (src/lib/play-upload.ts)
//   POST /api/upload/<id>/play {action:"create"} → { uploadId }
//   PUT  /api/upload/<id>/play?uploadId=…&part=N → { partNumber, etag } (play-upload.ts)
//   POST /api/upload/<id>/play {action:"complete", uploadId, parts}
//
// The R2 multipart upload in progress is kept on the copy's media_file row
// (upload_id): a new one aborts it, so a retried copy leaves no parts
// behind. The copy is checked by POST /api/upload/<id> (its size must be
// the original's, which taking out the metadata never changes).

export const onPost: RequestHandler = withErrorHandler(
  "POST /api/upload/[id]/play",
  async (ev) => {
    let body: { action?: unknown; uploadId?: unknown; parts?: unknown };
    try {
      body = (await ev.request.json()) as typeof body;
    } catch {
      ev.json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const bucket = getMediaCache(ev.platform);
    if (!bucket) {
      ev.json(503, { error: "動画の置き場 (R2) が設定されていません" });
      return;
    }
    const id = Number(ev.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      ev.json(400, { error: "アップロードの番号が正しくありません" });
      return;
    }
    const db = getDB(ev.platform);
    const row = await getVideoUpload(db, id);
    if (!row || row.size === null || row.play_key === null) {
      ev.json(404, { error: "このアップロードはもうありません（再読み込み）" });
      return;
    }
    const key = r2Key(row.play_key);
    const plan = planParts(row.size);
    if (!isMultipart(row.size)) {
      ev.json(400, { error: "1 回の PUT で送ってください" });
      return;
    }
    if (body.action === "create") {
      if (row.play_upload_id) {
        // An earlier try's parts: dropped (gone already is fine).
        try {
          await bucket.resumeMultipartUpload(key, row.play_upload_id).abort();
        } catch (err) {
          console.error("POST /api/upload/[id]/play: abort failed:", err);
        }
      }
      const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: row.content_type || "video/mp4" },
      });
      await setPlayUploadId(db, id, upload.uploadId);
      ev.json(200, { uploadId: upload.uploadId });
      return;
    }
    if (body.action !== "complete" || typeof body.uploadId !== "string") {
      ev.json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    if (body.uploadId !== row.play_upload_id) {
      ev.json(409, { error: "再生用コピーのアップロードがやり直されました" });
      return;
    }
    const parts = Array.isArray(body.parts) ? body.parts : [];
    const clean: R2UploadedPart[] = [];
    for (const p of parts as { partNumber?: unknown; etag?: unknown }[]) {
      if (
        typeof p?.partNumber !== "number" ||
        !Number.isInteger(p.partNumber) ||
        p.partNumber < 1 ||
        p.partNumber > plan.count ||
        typeof p.etag !== "string" ||
        p.etag.length > 200
      ) {
        ev.json(400, { error: "パートの形式が正しくありません" });
        return;
      }
      clean.push({ partNumber: p.partNumber, etag: p.etag });
    }
    const numbers = new Set(clean.map((p) => p.partNumber));
    if (clean.length !== plan.count || numbers.size !== plan.count) {
      ev.json(400, { error: "パートが揃っていません" });
      return;
    }
    try {
      await bucket
        .resumeMultipartUpload(key, body.uploadId)
        .complete(clean.sort((a, b) => a.partNumber - b.partNumber));
    } catch (err) {
      console.error("POST /api/upload/[id]/play: complete failed:", err);
      ev.json(409, {
        error: "再生用コピーをまとめられませんでした（やり直します）",
      });
      return;
    }
    await setPlayUploadId(db, id, null);
    ev.json(200, { ok: true });
  },
);
