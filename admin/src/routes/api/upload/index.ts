import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import { initUpload } from "~/lib/db-upload";
import { getDB } from "~/lib/env";
import { contentChanged, uploadsHideCameraPicture } from "~/lib/last-good";
import { generatePublicId } from "~/lib/public-id";
import { guessPlatform, validateUploadInit } from "~/lib/upload";

/**
 * Start (or resume) an upload: reserve the path as an `uploading` row and
 * return a presigned PUT for the browser to send the file to the bucket.
 * Body: { file, size, contentType, sha256, timestamp, meta? }
 * (validateUploadInit; `meta` is what the browser read from the file).
 *
 * 200 { status: "upload", id, file, url, headers } — PUT the file to `url`
 *     with exactly `headers`, then POST /api/upload/<id>. `file` is where
 *     it goes: a numbered name when the path was taken ("a-1.jpg").
 * 200 { status: "exists", id, file } — the same photo is already uploaded.
 * 409 { error } — no free name; 503 when uploads are not configured or
 *     another upload got the name first (retry).
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/upload",
  async ({ platform, request, json }) => {
    const config = getUploadConfig(platform);
    if (!config) {
      json(503, { error: "アップロードが設定されていません" });
      return;
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const v = validateUploadInit(body);
    if (!v.ok) {
      json(400, { error: v.error });
      return;
    }
    const { init } = v;
    const db = getDB(platform);
    const outcome = await initUpload(db, init, {
      publicId: generatePublicId(),
      platform: guessPlatform(init.file),
    });
    // A new row is private, so the public API is unchanged, unless it has
    // a camera picture's file: it hides that picture from /img already
    // (and the PUT replaces its object).
    if (
      outcome.kind === "upload" &&
      (await uploadsHideCameraPicture(db, [outcome.id]))
    ) {
      await contentChanged(platform, db, { hide: true });
    }
    if (outcome.kind === "conflict") {
      // A lost race is worth retrying (503); the rest is not (409).
      json(outcome.retry ? 503 : 409, { error: outcome.message });
      return;
    }
    if (outcome.kind === "exists") {
      json(200, { status: "exists", id: outcome.id, file: outcome.file });
      return;
    }
    const headers = putHeaders(init.contentType, init.sha256);
    const url = await presignPut(config, outcome.file, headers, new Date());
    json(200, {
      status: "upload",
      id: outcome.id,
      file: outcome.file,
      url,
      headers,
    });
  },
);
