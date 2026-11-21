import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig } from "~/lib/b2";
import {
  B2Error,
  completeMultipart,
  isRefused,
  listParts,
} from "~/lib/b2-multipart";
import { completeUpload, type VideoChecks } from "~/lib/db-upload";
import { getAdminImages, getDB, getMediaCache } from "~/lib/env";
import {
  checkParts,
  planParts,
  sentParts,
  type SentPart,
} from "~/lib/multipart";
import { r2Key } from "~/lib/video";
import { getObjectStat } from "~/lib/object-stat";

class StatError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StatError";
  }
}

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The browser's PUT succeeded: check the bucket really has the announced
 * file (size and SHA-256 metadata, through the image Worker, which can
 * read the bucket; object-stat.ts) and mark the photo ready.
 *
 * 200 ready; 404 no such upload; 409 the file is not in the bucket; 422 it
 * is not the announced one; 503 the bucket cannot be checked right now.
 */
export const onPost: RequestHandler = withErrorHandler(
  "POST /api/upload/[id]",
  async ({ platform, params, request, url, json }) => {
    const id = parseId(params.id);
    if (id === null) {
      json(400, { error: "アップロードの番号が正しくありません" });
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
    const db = getDB(platform);
    // Only the bucket check may throw here: a stat error is a 503 the
    // browser retries.
    const checked = async (file: string) => {
      try {
        return await stat(file);
      } catch (err) {
        throw new StatError(err);
      }
    };
    const config = getUploadConfig(platform);
    const bucket = getMediaCache(platform);
    // The parts of a video's original as the browser sent them (their
    // ETags), when it just did: then no ListParts is needed, which the
    // upload key may not be allowed (listFiles). Optional: a page view's
    // check of an incomplete upload sends nothing.
    let sent: unknown = null;
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        sent = ((await request.json()) as { parts?: unknown } | null)?.parts;
      } catch {
        json(400, { error: "リクエストの形式が正しくありません" });
        return;
      }
    }
    // A video's other objects: the original's parts put together (B2) and
    // the playback copy (R2). Only used for video rows.
    const video: VideoChecks = {
      async finishMultipart(file, uploadId, size) {
        if (!config) throw new StatError("アップロードが設定されていません");
        const plan = planParts(size);
        let parts: SentPart[] | null = sentParts(plan, sent);
        if (!parts) {
          let listed;
          try {
            listed = await listParts(config, file, uploadId);
          } catch (err) {
            // Without listFiles, only the browser that sent the parts can
            // finish the upload; another try starts it over. Unless an
            // earlier completion went through and only its answer (or the
            // row's update) was lost: then the object is whole, which the
            // completion checks (size, SHA-256) when told "gone".
            if (isRefused(err)) {
              const whole = await checked(file);
              return whole?.size === size ? "gone" : { missing: [] };
            }
            throw new StatError(err);
          }
          if (listed === null) return "gone";
          const missing = checkParts(plan, size, listed);
          if (missing) return { missing };
          parts = listed;
        }
        try {
          await completeMultipart(config, file, uploadId, parts);
        } catch (err) {
          // Completed by an earlier try whose answer was lost: the stat
          // decides. A part B2 does not have as reported: send it again.
          if (err instanceof B2Error && err.status === 404) return "gone";
          if (err instanceof B2Error && err.status === 400) {
            return { missing: [] };
          }
          throw new StatError(err);
        }
        return "done";
      },
      async playSize(key) {
        if (!bucket) throw new StatError("R2 が設定されていません");
        return (await bucket.head(r2Key(key)))?.size ?? null;
      },
    };
    let outcome;
    try {
      outcome = await completeUpload(db, id, checked, video);
    } catch (err) {
      if (!(err instanceof StatError)) throw err;
      console.error("POST /api/upload/[id]: stat failed:", err);
      json(503, { error: "確認できませんでした（時間をおいて再読み込み）" });
      return;
    }
    switch (outcome.kind) {
      case "ready": {
        // Its resized copies and cards, made now by Image Transformations
        // (the image Worker's makeCopies; else its cron within minutes, or
        // the browser maker when the site uses that), after the answer.
        const images = getAdminImages(platform);
        const made = images
          ?.makeCopies(request.headers.get("cf-access-jwt-assertion"), id)
          .then((r) => {
            if (!r.ok) console.error(`makeCopies ${id}: ${r.status}`);
          })
          .catch((err: unknown) =>
            console.error(`makeCopies ${id} failed:`, err),
          );
        const ctx = (platform as unknown as { ctx?: ExecutionContext } | null)
          ?.ctx;
        if (made && ctx) ctx.waitUntil(made);
        else if (made) await made;
        json(200, { id, status: "ready" });
        return;
      }
      case "not-found":
        json(404, { error: "このアップロードはもうありません（再読み込み）" });
        return;
      case "missing":
        json(409, { error: outcome.message ?? "B2 にファイルがありません" });
        return;
      case "mismatch":
        json(422, { error: outcome.message });
        return;
    }
  },
);
