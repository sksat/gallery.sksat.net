import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import { findSimilarPhoto } from "~/lib/db-merge";
import { ensureTags } from "~/lib/db-meta";
import { initUpload } from "~/lib/db-upload";
import { decideUpload } from "~/lib/db-upload-rules";
import { getDB } from "~/lib/env";
import { generatePublicId } from "~/lib/public-id";
import { DISPLAY_CONTENT_TYPE, validateUploadInit } from "~/lib/upload";

/**
 * Start (or resume) an upload: reserve the path as an `uploading` row and
 * return a presigned PUT for the browser to send the file to the bucket.
 * Body: { file, size, contentType, sha256, timestamp, meta?, hints? }
 * (validateUploadInit; `meta` is what the browser read from the file,
 * `hints` its CreatorTool for the upload rules, `width` / `height` its
 * header's size, checked against the limits and seen by the rules).
 *
 * 200 { status: "upload", id, file, url, headers, applied?, display? } —
 *     PUT the file to `url` with exactly `headers`, then POST
 *     /api/upload/<id>. `file` is where it goes: a numbered name when the
 *     path was taken ("a-1.jpg"). `applied`: what the upload rules set on
 *     a new row. With `display` in the body (an original over the resize
 *     limits), `display: { file, url, headers }` is the display copy's
 *     PUT (a media_file row, role display), made before the complete.
 *     `similar`: a photo in the folder of the same name, or of the name
 *     without retouch suffixes, that a new photo may be a retouch of.
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
    // The upload rules decide here, on the server, so they always apply.
    const decided = await decideUpload(db, init);
    // A tag first used here gets its (private) row, as on the edit page;
    // before the row, so a failure here leaves nothing half done (a row
    // for a photo that turns out to exist is harmless).
    if (decided.row.tags && decided.row.tags.length > 0) {
      await ensureTags(db, decided.row.tags);
    }
    const outcome = await initUpload(db, init, {
      publicId: generatePublicId(),
      ...decided.row,
    });
    // A new row is still uploading (also one a rule makes public: the API
    // shows ready rows only, and completeUpload bumps for it), so the
    // public API is unchanged (its file is never a camera picture's, 0019).
    if (outcome.kind === "conflict") {
      // A lost race is worth retrying (503); the rest is not (409).
      json(outcome.retry ? 503 : 409, { error: outcome.message });
      return;
    }
    if (outcome.kind === "exists") {
      json(200, { status: "exists", id: outcome.id, file: outcome.file });
      return;
    }
    const now = new Date();
    const headers = putHeaders(init.contentType, init.sha256);
    const url = await presignPut(config, outcome.file, headers, now);
    // An original over the resize limits: its display copy's PUT too.
    let display:
      | { file: string; url: string; headers: Record<string, string> }
      | undefined;
    if (outcome.display && init.display) {
      const h = putHeaders(DISPLAY_CONTENT_TYPE, init.display.sha256);
      display = {
        file: outcome.display,
        url: await presignPut(config, outcome.display, h, now),
        headers: h,
      };
    }
    // A photo this one may be a retouched version of (the panel offers to
    // make it one). Only a hint: without it the upload goes on.
    const similar = outcome.resumed
      ? null
      : await findSimilarPhoto(db, init.file, outcome.id, {
          timestamp: init.timestamp,
          creatorTool: init.hints?.creatorTool ?? null,
        }).catch((err: unknown) => {
          console.error("POST /api/upload: similar photo lookup failed:", err);
          return null;
        });
    json(200, {
      status: "upload",
      id: outcome.id,
      file: outcome.file,
      url,
      headers,
      // What the rules set on the new row (a resumed row keeps its own).
      ...(outcome.resumed ? {} : { applied: decided.applied }),
      ...(display ? { display } : {}),
      ...(similar ? { similar } : {}),
    });
  },
);
