import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import {
  completeEditUpload,
  deleteIncompleteEdit,
  initEditUpload,
} from "~/lib/db-retouch";
import { getDB } from "~/lib/env";
import { getObjectStat } from "~/lib/object-stat";
import { DISPLAY_CONTENT_TYPE, validateUploadInit } from "~/lib/upload";

const parseId = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Add a retouched version to photo <id>: the browser uploads the file
 * straight to the bucket, like an original (POST /api/upload), in steps.
 * Body: { step, ... }.
 *
 * step "init" (the rest as POST /api/upload's body; `file` is in the
 *   photo's folder): 200 { status: "upload", id, file, url, headers,
 *   display? } — PUT the file, then send step "complete" with this `id`
 *   (the edit's media_file row); 200 { status: "exists", id, file } when
 *   the photo has the file already (a removed one comes back); 409 the
 *   bytes are another file's, or no free name; 503 a lost race (retry).
 * step "complete" { id }: the bucket must have it as announced
 *   (AdminImage.stat). 200 ready; 404 no such upload; 409 not in the
 *   bucket; 422 not the announced file; 503 cannot check now.
 * step "delete" { id }: forget an upload of it that never completed.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/media/[id]/file",
  async ({ platform, params, request, url, json }) => {
    const mediaId = parseId(params.id);
    if (mediaId === null) {
      json(400, { error: "写真の番号が正しくありません" });
      return;
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const db = getDB(platform);

    if (body.step === "delete") {
      const id = parseId(body.id);
      if (id === null) {
        json(400, { error: "リクエストの形式が正しくありません" });
        return;
      }
      json(200, { deleted: await deleteIncompleteEdit(db, mediaId, id) });
      return;
    }

    if (body.step === "complete") {
      const id = parseId(body.id);
      if (id === null) {
        json(400, { error: "リクエストの形式が正しくありません" });
        return;
      }
      const stat = getObjectStat(
        platform,
        url,
        request.headers.get("cf-access-jwt-assertion"),
      );
      if (!stat) {
        json(503, { error: "アップロードの確認が設定されていません" });
        return;
      }
      let statFailed = false;
      const outcome = await completeEditUpload(db, mediaId, id, async (f) => {
        try {
          return await stat(f);
        } catch (err) {
          statFailed = true;
          throw err;
        }
      }).catch((err: unknown) => {
        if (!statFailed) throw err;
        console.error("POST /api/media/[id]/file: stat failed:", err);
        return null;
      });
      if (outcome === null) {
        json(503, { error: "確認できませんでした（時間をおいて再読み込み）" });
        return;
      }
      switch (outcome.kind) {
        case "ready":
          json(200, { id, status: "ready" });
          return;
        case "not-found":
          json(404, {
            error: "このアップロードはもうありません（再読み込み）",
          });
          return;
        case "missing":
          json(409, { error: "B2 にファイルがありません" });
          return;
        case "mismatch":
          json(422, { error: outcome.message });
          return;
      }
    }

    if (body.step !== "init") {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const config = getUploadConfig(platform);
    if (!config) {
      json(503, { error: "アップロードが設定されていません" });
      return;
    }
    const v = validateUploadInit(body);
    if (!v.ok) {
      json(400, { error: v.error });
      return;
    }
    const { init } = v;
    const outcome = await initEditUpload(db, mediaId, init);
    if (outcome.kind === "conflict") {
      json(outcome.retry ? 503 : 409, { error: outcome.message });
      return;
    }
    if (outcome.kind === "exists") {
      json(200, { status: "exists", id: outcome.id, file: outcome.file });
      return;
    }
    const now = new Date();
    const headers = putHeaders(init.contentType, init.sha256);
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
      url: await presignPut(config, outcome.file, headers, now),
      headers,
      ...(display ? { display } : {}),
    });
  },
);
