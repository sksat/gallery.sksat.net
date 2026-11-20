import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import { firstFreeName, validateCameraUpload } from "~/lib/camera-image";
import { getCamera, listCameraImages } from "~/lib/db";
import {
  addUploadedPicture,
  holdsPictureName,
  reservePictureName,
  takenPictureNames,
} from "~/lib/db-camera-image";
import { sizeMismatch } from "~/lib/db-upload";
import { getDB } from "~/lib/env";
import { getObjectStat } from "~/lib/object-stat";

/** Bucket checks for a free name per upload (each is a request). */
const MAX_PROBES = 5;

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Upload a picture of camera <id> straight to the bucket, like a photo
 * (POST /api/upload), in two steps. Body: { step, file, size, contentType,
 * sha256, width?, height? } (validateCameraUpload; `file` is in the
 * camera's folder, /camera/<slug>/<name>).
 *
 * step "init": 200 { file, url, headers } — PUT the file to `url` with
 *   exactly `headers`, then send step "complete" with the same body and
 *   this `file`: a numbered name when the name is taken (by a picture or a
 *   photo's file, an object already in the bucket, or another upload's
 *   claim, reservePictureName, so two uploads never share one).
 * step "complete": the claim must be this upload's and the bucket must
 *   have the file with that size and SHA-256 (AdminImage.stat); then the
 *   picture is added after the last one (and the claim dropped, with the
 *   content version, in one batch). 200 { id }; 409 not in the bucket, no
 *   free name, or no claim; 422 not the announced file; 503 not
 *   configured or the bucket cannot be checked.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/camera/[id]/image",
  async ({ platform, params, request, url, json }) => {
    const id = parseId(params.id);
    if (id === null) {
      json(400, { error: "カメラの番号が正しくありません" });
      return;
    }
    const config = getUploadConfig(platform);
    const stat = getObjectStat(
      platform,
      url,
      request.headers.get("cf-access-jwt-assertion"),
    );
    if (!config || !stat) {
      json(503, { error: "アップロードが設定されていません" });
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
    const camera = await getCamera(db, id);
    if (!camera) {
      json(404, { error: "このカメラはもうありません（再読み込み）" });
      return;
    }
    // The completion's path was given out by init, maybe before the
    // camera's slug changed: any camera folder, proven by the claim.
    const v = validateCameraUpload(
      body,
      body.step === "complete" ? null : camera.slug,
    );
    if (!v.ok) {
      json(400, { error: v.error });
      return;
    }
    const { init } = v;
    const checked = async (file: string) => {
      try {
        return { ok: true as const, stat: await stat(file) };
      } catch (err) {
        console.error("POST /api/camera/[id]/image: stat failed:", err);
        return { ok: false as const };
      }
    };

    if (body.step === "init") {
      const { candidates, taken } = await takenPictureNames(db, init.file);
      let statFailed = false;
      const file = await firstFreeName(
        // A numbered name must still be one the completion accepts.
        candidates.filter(
          (c) => validateCameraUpload({ ...body, file: c }, camera.slug).ok,
        ),
        taken,
        async (f) => {
          const r = await checked(f);
          if (!r.ok) {
            statFailed = true;
            // Unknown: not used, so nothing is overwritten.
            return true;
          }
          if (r.stat === null) return false;
          // This upload's own name and bytes (a retry after a PUT whose
          // answer was lost): resumed, not numbered.
          return !(
            r.stat.sha256 === init.sha256 &&
            (await holdsPictureName(db, f, id, init.sha256))
          );
        },
        MAX_PROBES,
        (f) => reservePictureName(db, f, id, init.sha256, new Date(), true),
      );
      if (statFailed && !file) {
        json(503, { error: "確認できませんでした（時間をおいてもう一度）" });
        return;
      }
      if (!file) {
        json(409, {
          error: "空いている名前がありません（名前を変えてください）",
        });
        return;
      }
      const headers = putHeaders(init.contentType, init.sha256);
      json(200, {
        file,
        url: await presignPut(config, file, headers, new Date()),
        headers,
      });
      return;
    }

    if (body.step === "complete") {
      if (!(await holdsPictureName(db, init.file, id, init.sha256))) {
        // Added already (a retry whose answer was lost)?
        const images = await listCameraImages(db, id);
        if (images.some((img) => img.file === init.file)) {
          // ... with these bytes (not a later picture at the same path).
          const r = await checked(init.file);
          if (r.ok && r.stat?.sha256 === init.sha256) {
            json(200, { status: "exists" });
            return;
          }
        }
        json(409, { error: "アップロードし直してください" });
        return;
      }
      const r = await checked(init.file);
      if (!r.ok) {
        json(503, { error: "確認できませんでした（時間をおいてもう一度）" });
        return;
      }
      if (!r.stat) {
        json(409, { error: "B2 にファイルがありません" });
        return;
      }
      if (r.stat.size !== init.size) {
        json(422, {
          error: `大きさが違います：${sizeMismatch(r.stat.size, init.size)}です。`,
        });
        return;
      }
      if (r.stat.sha256 !== init.sha256) {
        json(422, { error: "中身が違います (SHA-256 が一致しません)" });
        return;
      }
      const imageId = await addUploadedPicture(db, id, init.file);
      json(200, imageId === null ? { status: "exists" } : { id: imageId });
      return;
    }

    json(400, { error: "リクエストの形式が正しくありません" });
  },
);
