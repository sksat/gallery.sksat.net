import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import {
  abortMultipart,
  createMultipart,
  isRefused,
  listParts,
} from "~/lib/b2-multipart";
import { ensureTags } from "~/lib/db-meta";
import { initUpload, setUploadId } from "~/lib/db-upload";
import { decideUpload } from "~/lib/db-upload-rules";
import { getDB, getMediaCache } from "~/lib/env";
import { doneParts, isMultipart, planParts } from "~/lib/multipart";
import { getObjectStat } from "~/lib/object-stat";
import { generatePublicId } from "~/lib/public-id";
import { DISPLAY_CONTENT_TYPE, validateUploadInit } from "~/lib/upload";
import { newPlayKey, newPosterKey, r2Key } from "~/lib/video";

/**
 * Start (or resume) an upload: reserve the path as an `uploading` row and
 * return a presigned PUT for the browser to send the file to the bucket.
 * Body: { file, size, contentType, sha256, timestamp, meta?, hints?, video? }
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
 * 200 { status: "upload", id, file, video: { original, poster, play },
 *     applied? } — a video: the original goes to B2 as one PUT
 *     (`original.mode` "single", `url` + `headers`) or in parts
 *     ("multipart": `uploadId`, `partSize`, `count`, `done` = parts B2
 *     already has; part URLs from POST /api/upload/<id>/parts); the poster,
 *     if any, is one PUT; the playback copy goes through
 *     PUT /api/upload/<id>/play. Then POST /api/upload/<id>.
 * 200 { status: "exists", id, file } — the same photo is already uploaded.
 * 409 { error } — no free name; 503 when uploads are not configured or
 *     another upload got the name first (retry).
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/upload",
  async ({ platform, request, url, json }) => {
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
    if (init.kind === "video" && !getMediaCache(platform)) {
      json(503, { error: "動画の置き場 (R2) が設定されていません" });
      return;
    }
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
      ...(init.kind === "video"
        ? {
            video: {
              posterKey: newPosterKey(),
              playKey: newPlayKey(init.contentType),
            },
          }
        : {}),
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
    if (!outcome.video) {
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
      json(200, {
        status: "upload",
        id: outcome.id,
        file: outcome.file,
        url,
        headers,
        // What the rules set on the new row (a resumed row keeps its own).
        ...(outcome.resumed ? {} : { applied: decided.applied }),
        ...(display ? { display } : {}),
      });
      return;
    }
    const plan = planParts(init.size);
    let original;
    // A resumed video whose original is whole in B2 already (an earlier
    // try's multipart upload was completed, then a copy failed): not sent
    // again. Checked through the image Worker's stat, like a completion.
    const stat = outcome.resumed
      ? getObjectStat(
          platform,
          url,
          request.headers.get("cf-access-jwt-assertion"),
        )
      : null;
    const have = stat ? await stat(outcome.file).catch(() => null) : null;
    if (have && have.size === init.size && have.sha256 === init.sha256) {
      original = { mode: "done" };
    } else if (!isMultipart(init.size)) {
      original = {
        mode: "single",
        url: await presignPut(config, outcome.file, headers, now),
        headers,
      };
    } else {
      // Resume the parts B2 already has; start over when that upload is
      // gone (completed, aborted, expired).
      let uploadId = outcome.video.uploadId;
      let done: number[] = [];
      if (uploadId !== null) {
        let parts;
        try {
          parts = await listParts(config, outcome.file, uploadId);
        } catch (err) {
          if (!isRefused(err)) throw err;
          // The key cannot list parts (no listFiles): what B2 has is
          // unknown, so the upload starts over (its parts dropped).
          await abortMultipart(config, outcome.file, uploadId).catch(
            (e: unknown) => console.error("abort before restart:", e),
          );
          parts = null;
        }
        if (parts === null) uploadId = null;
        else done = doneParts(plan, init.size, parts);
      }
      if (uploadId === null) {
        uploadId = await createMultipart(config, outcome.file, headers);
        await setUploadId(db, outcome.id, uploadId);
      }
      original = {
        mode: "multipart",
        uploadId,
        partSize: plan.partSize,
        count: plan.count,
        done,
      };
    }
    const { posterKey } = outcome.video;
    // Likewise its playback copy (R2 knows only the size).
    const bucket = getMediaCache(platform);
    const copied =
      outcome.resumed && bucket
        ? (await bucket.head(r2Key(outcome.video.playKey)))?.size === init.size
        : false;
    const posterHeaders =
      posterKey !== null && init.video?.posterSha256
        ? putHeaders("image/jpeg", init.video.posterSha256)
        : null;
    json(200, {
      status: "upload",
      id: outcome.id,
      file: outcome.file,
      video: {
        original,
        poster: posterHeaders
          ? {
              url: await presignPut(config, posterKey!, posterHeaders, now),
              headers: posterHeaders,
            }
          : null,
        play: {
          multipart: isMultipart(init.size),
          partSize: plan.partSize,
          count: plan.count,
          ...(copied ? { done: true } : {}),
        },
      },
      ...(outcome.resumed ? {} : { applied: decided.applied }),
    });
  },
);
