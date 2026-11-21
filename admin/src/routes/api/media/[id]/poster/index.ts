import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getUploadConfig, presignPut, putHeaders } from "~/lib/b2";
import { deleteAllVersions } from "~/lib/b2-delete";
import { getDB } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";
import { getObjectStat } from "~/lib/object-stat";
import { newPosterKey, POSTER_KEY_RE } from "~/lib/video";

// A new poster for a video, made in the browser from the edit page's
// player (when the uploading browser could not decode the video, or to
// pick another frame). Like an upload: the browser PUTs the JPEG straight
// to B2, then this route checks it arrived and makes it the video's poster
// (a media_file row with role 'poster', made from the original).
//
//   POST /api/media/<id>/poster { sha256 } → { file, url, headers }
//   PUT  /api/media/<id>/poster { file, sha256 } → { ok }
//
// A new poster always gets a new key (video.ts), so no cache keeps the old
// frame; the old rows go and their objects are deleted afterwards.

const SHA256_RE = /^[0-9a-f]{64}$/;

const videoRow = (db: D1Database, id: number) =>
  db
    .prepare(
      `SELECT m.id, m.visibility, o.id AS original_id
       FROM media m JOIN media_file o ON o.media_id = m.id AND o.role = 'original'
       WHERE m.id = ? AND m.kind = 'video' AND m.status = 'ready'`,
    )
    .bind(id)
    .first<{ id: number; visibility: string; original_id: number }>();

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const onPost: RequestHandler = withErrorHandler(
  "POST /api/media/[id]/poster",
  async ({ platform, params, request, json }) => {
    const config = getUploadConfig(platform);
    if (!config) {
      json(503, { error: "アップロードが設定されていません" });
      return;
    }
    const id = parseId(params.id);
    const body = (await request.json().catch(() => null)) as {
      sha256?: unknown;
    } | null;
    if (
      id === null ||
      typeof body?.sha256 !== "string" ||
      !SHA256_RE.test(body.sha256)
    ) {
      json(400, { error: "リクエストの形式が正しくありません" });
      return;
    }
    const db = getDB(platform);
    if (!(await videoRow(db, id))) {
      json(404, { error: "動画が見つかりません" });
      return;
    }
    // Every file's bytes are unique (0013): a frame some file already is
    // (this video's poster now, say) is not uploaded again.
    if (
      await db
        .prepare("SELECT 1 FROM media_file WHERE sha256 = ?")
        .bind(body.sha256)
        .first()
    ) {
      json(409, {
        error: "同じ画像がもうあります（別の場面を選んでください）",
      });
      return;
    }
    const file = newPosterKey();
    const headers = putHeaders("image/jpeg", body.sha256);
    json(200, {
      file,
      url: await presignPut(config, file, headers, new Date()),
      headers,
    });
  },
);

export const onPut: RequestHandler = withErrorHandler(
  "PUT /api/media/[id]/poster",
  async ({ platform, params, request, url, json }) => {
    const id = parseId(params.id);
    const body = (await request.json().catch(() => null)) as {
      file?: unknown;
      sha256?: unknown;
    } | null;
    if (
      id === null ||
      typeof body?.file !== "string" ||
      !POSTER_KEY_RE.test(body.file) ||
      typeof body.sha256 !== "string" ||
      !SHA256_RE.test(body.sha256)
    ) {
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
    const db = getDB(platform);
    const row = await videoRow(db, id);
    if (!row) {
      json(404, { error: "動画が見つかりません" });
      return;
    }
    const object = await stat(body.file);
    // The object must be the JPEG this request speaks of (its PUT was
    // signed over that hash), not some other key that happens to exist.
    if (!object || object.sha256 !== body.sha256) {
      json(409, { error: "B2 にポスターがありません" });
      return;
    }
    // The old posters, then the new one, in one batch: the video always
    // has at most one, and its hash (unique among all files) is what the
    // bucket recorded with it.
    let old: D1Result<unknown>;
    try {
      [old] = await db.batch([
        db
          .prepare(
            `DELETE FROM media_file WHERE media_id = ? AND role = 'poster'
           RETURNING object_key AS key`,
          )
          .bind(id),
        db
          .prepare(
            `INSERT INTO media_file (media_id, role, storage, object_key,
             source_file_id, status, size, sha256, mime_type, uploaded_at)
           VALUES (?1, 'poster', 'b2', ?2, ?3, 'ready', ?4, ?5, 'image/jpeg',
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          )
          .bind(id, body.file, row.original_id, object.size, object.sha256),
      ]);
    } catch (err) {
      if (!(
        err instanceof Error && /UNIQUE constraint failed/.test(err.message)
      )) {
        throw err;
      }
      // Its bytes or key are some other file's (a race with another
      // upload): nothing changed. The object just sent is dropped unless
      // that other file is this very key.
      const other = await db
        .prepare(
          "SELECT 1 FROM media_file WHERE storage = 'b2' AND object_key = ?",
        )
        .bind(body.file)
        .first();
      const config = getUploadConfig(platform);
      if (!other && config) {
        await deleteAllVersions(config, body.file).catch((e) =>
          console.error("PUT /api/media/[id]/poster: cleanup:", e),
        );
      }
      json(409, {
        error: "同じ画像がもうあります（別の場面を選んでください）",
      });
      return;
    }
    // The image Worker finds the poster through the API (its photo RPC),
    // so a public or unlisted video's thumbnails and og:image change.
    if (row.visibility !== "private") await contentChanged(db);
    const config = getUploadConfig(platform);
    for (const o of (old.results ?? []) as { key: string }[]) {
      if (o.key === body.file || !config) continue;
      try {
        await deleteAllVersions(config, o.key);
      } catch (err) {
        // Unreferenced and never served by path: harmless if left.
        console.error("PUT /api/media/[id]/poster: old poster:", err);
      }
    }
    json(200, { ok: true });
  },
);
