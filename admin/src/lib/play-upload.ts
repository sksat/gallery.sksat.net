// PUT /api/upload/<id>/play[?uploadId=…&part=N]: one part (or the whole)
// of a video's playback copy, straight from the request into R2.
//
// Handled before Qwik City (src/entry.cloudflare-pages.tsx), not as a
// route: Qwik City wraps every request body in a JS stream that counts its
// bytes (its request body limit), so each chunk of a 64 MiB part would go
// through JavaScript, which the Free plan's 10 ms of CPU time cannot pay
// for. Here the incoming body, whose length the runtime knows, is handed
// to R2 as it is. The Access check (plugin@access.ts's) and the Origin
// check (api.ts's) are made here too, as nothing else runs before this.
// The create / complete calls are small JSON and stay in the route
// (src/routes/api/upload/[id]/play/).

import { checkAccess } from "./access";
import { getVideoUpload } from "./db-upload";
import { isMultipart, partRange, planParts } from "./multipart";
import { r2Key } from "./video";

/** The paths this handles (PUT only). */
export const PLAY_PUT_RE = /^\/api\/upload\/(\d+)\/play\/?$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export type PlayPutDeps = {
  /** checkAccess, injectable for tests. */
  access?: typeof checkAccess;
};

export const handlePlayPut = async (
  request: Request,
  env: Record<string, unknown>,
  { access = checkAccess }: PlayPutDeps = {},
): Promise<Response> => {
  const url = new URL(request.url);
  const m = PLAY_PUT_RE.exec(url.pathname);
  if (request.method !== "PUT" || !m) return json(404, { error: "not found" });
  const auth = await access({
    url,
    headers: request.headers,
    env,
    dev: false,
  });
  if (!auth.ok) {
    console.error(`[access] ${auth.status} ${request.url}: ${auth.reason}`);
    return new Response(
      auth.status === 403 ? "Forbidden" : "Service unavailable",
      {
        status: auth.status,
      },
    );
  }
  // As withErrorHandler (api.ts): a cross-origin or Origin-less request is
  // refused.
  if (request.headers.get("origin") !== url.origin) {
    return json(403, { error: "cross-origin request rejected" });
  }
  const bucket = env.MEDIA_CACHE as R2Bucket | undefined;
  const db = env.DB as D1Database | undefined;
  if (!bucket || !db) {
    return json(503, { error: "動画の置き場 (R2) が設定されていません" });
  }
  try {
    const row = await getVideoUpload(db, Number(m[1]));
    if (!row || row.size === null || row.play_key === null) {
      return json(404, {
        error: "このアップロードはもうありません（再読み込み）",
      });
    }
    const key = r2Key(row.play_key);
    const plan = planParts(row.size);
    const uploadId = url.searchParams.get("uploadId");
    let expected = row.size;
    let part = 0;
    if (uploadId === null) {
      if (isMultipart(row.size)) {
        return json(400, { error: "パートに分けて送ってください" });
      }
    } else {
      // Only the copy's current upload (an older tab's was aborted).
      if (uploadId !== row.play_upload_id) {
        return json(409, {
          error: "再生用コピーのアップロードがやり直されました",
        });
      }
      part = Number(url.searchParams.get("part"));
      if (!Number.isInteger(part) || part < 1 || part > plan.count) {
        return json(400, { error: "パートの番号が正しくありません" });
      }
      const { start, end } = partRange(plan, row.size, part);
      expected = end - start;
    }
    const length = Number(request.headers.get("content-length"));
    if (!request.body || length !== expected) {
      return json(400, {
        error: `大きさが違います（${expected} バイトのはずが ${Number.isFinite(length) ? length : "不明"}）`,
      });
    }
    if (uploadId === null) {
      await bucket.put(key, request.body, {
        httpMetadata: { contentType: row.content_type || "video/mp4" },
      });
      return json(200, { ok: true });
    }
    try {
      const uploaded = await bucket
        .resumeMultipartUpload(key, uploadId)
        .uploadPart(part, request.body);
      return json(200, {
        partNumber: uploaded.partNumber,
        etag: uploaded.etag,
      });
    } catch (err) {
      // An unknown or finished upload id: the browser starts the copy over.
      console.error("PUT play: uploadPart failed:", err);
      return json(409, {
        error: "再生用コピーのアップロードがやり直されました",
      });
    }
  } catch (err) {
    console.error("PUT play failed:", err);
    return json(500, { error: "internal server error" });
  }
};
