import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { completeUpload } from "~/lib/db-upload";
import { getDB } from "~/lib/env";
import { contentChanged, uploadsOverCameraPicture } from "~/lib/last-good";
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
    let outcome;
    try {
      outcome = await completeUpload(db, id, checked);
    } catch (err) {
      if (!(err instanceof StatError)) throw err;
      console.error("POST /api/upload/[id]: stat failed:", err);
      json(503, { error: "確認できませんでした（時間をおいて再読み込み）" });
      return;
    }
    switch (outcome.kind) {
      case "ready":
        if (await uploadsOverCameraPicture(db, [id])) {
          await contentChanged(db);
        }
        json(200, { id, status: "ready" });
        return;
      case "not-found":
        json(404, { error: "このアップロードはもうありません（再読み込み）" });
        return;
      case "missing":
        json(409, { error: "B2 にファイルがありません" });
        return;
      case "mismatch":
        json(422, { error: outcome.message });
        return;
    }
  },
);
