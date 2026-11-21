import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig } from "~/lib/b2";
import { presignParts } from "~/lib/b2-multipart";
import { getVideoUpload } from "~/lib/db-upload";
import { getDB } from "~/lib/env";
import { planParts, SIGN_BATCH, validPartNumbers } from "~/lib/multipart";

/**
 * Presigned UploadPart URLs for the original of an upload in progress.
 * Body: { uploadId, parts: [n, …] } (at most SIGN_BATCH numbers, so one
 * request stays within the Free plan's CPU time).
 *
 * 200 { parts: [{ partNumber, url }] }; 400 bad numbers; 404 no such
 * upload; 409 the upload id is not the row's (another tab started over).
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/upload/[id]/parts",
  async ({ platform, params, request, json }) => {
    const config = getUploadConfig(platform);
    if (!config) {
      json(503, { error: "アップロードが設定されていません" });
      return;
    }
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      json(400, { error: "アップロードの番号が正しくありません" });
      return;
    }
    let body: { uploadId?: unknown; parts?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const row = await getVideoUpload(getDB(platform), id);
    if (!row || row.size === null) {
      json(404, { error: "このアップロードはもうありません（再読み込み）" });
      return;
    }
    if (row.upload_id === null || body.uploadId !== row.upload_id) {
      json(409, { error: "アップロードがやり直されました（もう一度）" });
      return;
    }
    const numbers = validPartNumbers(planParts(row.size), body.parts);
    if (!numbers) {
      json(400, {
        error: `パートの番号が正しくありません（${SIGN_BATCH} 個まで）`,
      });
      return;
    }
    json(200, {
      parts: await presignParts(config, row.file, row.upload_id, numbers),
    });
  },
);
