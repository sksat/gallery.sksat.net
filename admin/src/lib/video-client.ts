// Browser side of a video upload (the logic that can be tested without a
// browser is in multipart.ts, video-meta.ts and sha256.ts):
//
// 1. prepare: the container's own description (video-meta.ts: size,
//    length, codec, taken-at, position, device, and the patches that make
//    the playback copy), a poster drawn from a frame about 1 s in through
//    <video> + <canvas> (none when the browser cannot decode it, e.g. HEVC
//    in Firefox on Linux: the edit page can make one later), and the
//    SHA-256 of the whole file, read a slice at a time.
// 2. put: the original to B2 (one PUT, or parts through presigned
//    UploadPart URLs, skipping the parts B2 already has), the poster to
//    B2 (one PUT), and the playback copy (the original with the patches
//    applied, assembled as a Blob of slices, so nothing is copied in
//    memory) to R2 through the admin (/api/upload/<id>/play).

import { hashBlob } from "./sha256";
import {
  partRange,
  missingParts,
  SIGN_BATCH,
  type PartPlan,
} from "./multipart";
import type { StoredMeta } from "./photo-meta";
import { PHOTO_META_PARSER_DATE } from "./photo-meta";
import { checkUploadLimits, uploadContentType } from "./upload";
import { UploadError, type Prepared } from "./upload-queue";
import {
  readVideoMeta,
  VideoMetaError,
  type BytePatch,
  type VideoMeta,
} from "./video-meta";

/** What a prepared video keeps in the browser (never sent as JSON). */
type Extras = {
  poster: Blob | null;
  play: Blob;
  /**
   * The playback copy's R2 multipart upload and the parts it has, kept
   * across the queue's tries of this file, so a retry sends only the rest.
   */
  r2?: { uploadId: string; parts: Map<number, string> };
};
const extras = new WeakMap<object, Extras>();

/** The playback copy: the original's slices with the patches between. */
export const playBlob = (
  original: Blob,
  patches: readonly BytePatch[],
  type: string,
): Blob => {
  const parts: BlobPart[] = [];
  let at = 0;
  for (const p of [...patches].sort((a, b) => a.offset - b.offset)) {
    if (p.offset < at) throw new Error("overlapping patches");
    parts.push(original.slice(at, p.offset));
    parts.push(p.bytes as Uint8Array<ArrayBuffer>);
    at = p.offset + p.bytes.length;
  }
  parts.push(original.slice(at));
  return new Blob(parts, { type });
};

/** The poster's longest side (a frame larger than 4K is scaled down). */
const POSTER_MAX_SIDE = 3840;
/** How long decoding may take before the upload goes on without a poster. */
const POSTER_TIMEOUT_MS = 15_000;

type Decoded = {
  poster: Blob | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

/**
 * Let the browser open the video: its size and length (when the container
 * did not say) and a JPEG of a frame about 1 s in. Never throws: a video
 * the browser cannot decode gives no poster.
 */
export const decodeVideo = (blob: Blob): Promise<Decoded> =>
  new Promise((resolve) => {
    const none: Decoded = {
      poster: null,
      width: null,
      height: null,
      durationMs: null,
    };
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let settled = false;
    const finish = (out: Decoded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => finish(none), POSTER_TIMEOUT_MS);
    const meta = (): Decoded => ({
      poster: null,
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      durationMs: Number.isFinite(video.duration)
        ? Math.round(video.duration * 1000)
        : null,
    });
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish(none);
    video.onloadedmetadata = () => {
      const d = video.duration;
      // About 1 s in (past a fade-in), or the middle of a shorter clip.
      video.currentTime = Number.isFinite(d) && d > 2 ? 1 : (d || 0) / 2;
    };
    video.onseeked = () => {
      const m = meta();
      void frameToJpeg(video).then((poster) => finish({ ...m, poster }));
    };
    video.src = url;
  });

/** The frame a <video> shows now, as a JPEG; null when it has none. */
export const frameToJpeg = (video: HTMLVideoElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return resolve(null);
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(null);
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      return resolve(null);
    }
    canvas.toBlob((jpeg) => resolve(jpeg), "image/jpeg", 0.85);
  });

/**
 * Make `jpeg` the video's poster: the admin signs a PUT to a new key, the
 * browser sends it, the admin checks it and switches the row over
 * (/api/media/<id>/poster).
 */
export const replacePoster = async (
  id: number,
  jpeg: Blob,
  t: Transport,
): Promise<void> => {
  const sha256 = hex(
    await crypto.subtle.digest("SHA-256", await jpeg.arrayBuffer()),
  );
  const path = `/api/media/${id}/poster`;
  const signed = (await t.api("POST", path, { sha256 })) as {
    file: string;
    url: string;
    headers: Record<string, string>;
  };
  await t.put(signed.url, signed.headers, jpeg, () => {});
  await t.api("PUT", path, { file: signed.file, sha256 });
};

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

/** The file's own metadata in the shape uploads store (photo-meta.ts). */
export const videoStoredMeta = (meta: VideoMeta): StoredMeta => {
  const device =
    meta.make || meta.model
      ? {
          ...(meta.make ? { make: meta.make } : {}),
          ...(meta.model ? { model: meta.model } : {}),
        }
      : null;
  return {
    exif: device,
    fileExif: device,
    digitizedAt: null,
    location: meta.location,
    world: null,
    photographer: null,
    vrcx: null,
  };
};

export type VideoSource = {
  name: string;
  size: number;
  type: string;
  blob: Blob;
};

/** Prepare a video for upload (see the top of the file). */
export const prepareVideo = async (f: VideoSource): Promise<Prepared> => {
  const contentType = uploadContentType(f.name, f.type);
  if (!contentType) throw new UploadError("動画の種類が分かりません", false);
  const refused = checkUploadLimits({ size: f.size });
  if (refused) throw new UploadError(refused, false);
  let meta: VideoMeta | null;
  try {
    meta = await readVideoMeta(
      f.size,
      async (offset, length) =>
        new Uint8Array(
          await f.blob.slice(offset, offset + length).arrayBuffer(),
        ),
    );
  } catch (err) {
    if (err instanceof VideoMetaError)
      throw new UploadError(err.message, false);
    throw err;
  }
  if (!meta) throw new UploadError("動画として読めません", false);
  const decoded = await decodeVideo(f.blob);
  const [sha256, posterSha256] = await Promise.all([
    hashBlob(f.blob),
    decoded.poster
      ? decoded.poster
          .arrayBuffer()
          .then((b) => crypto.subtle.digest("SHA-256", b))
          .then(hex)
      : Promise.resolve(null),
  ]);
  const prepared: Prepared = {
    sha256,
    contentType,
    kind: "video",
    width: meta.width ?? decoded.width,
    height: meta.height ?? decoded.height,
    timestamp: meta.takenAt?.at ?? null,
    ...(meta.takenAt ? { timestampSource: meta.takenAt.source } : {}),
    meta: videoStoredMeta(meta),
    parserDate: PHOTO_META_PARSER_DATE,
    video: {
      durationMs: meta.durationMs ?? decoded.durationMs,
      codec: meta.codec,
      posterSha256,
    },
  };
  extras.set(prepared, {
    poster: decoded.poster,
    play: playBlob(f.blob, meta.patches, f.blob.type),
  });
  return prepared;
};

/** The blobs prepareVideo kept for this preparation. */
export const videoExtras = (prepared: Prepared): Extras | undefined =>
  extras.get(prepared);

// --- sending ----------------------------------------------------------------

/** What POST /api/upload answers for a video. */
export type VideoInitResult = {
  original:
    /** B2 has it already (an earlier try got that far). */
    | { mode: "done" }
    | { mode: "single"; url: string; headers: Record<string, string> }
    | {
        mode: "multipart";
        uploadId: string;
        partSize: number;
        count: number;
        done: number[];
      };
  poster: { url: string; headers: Record<string, string> } | null;
  play: {
    multipart: boolean;
    partSize: number;
    count: number;
    /** R2 has the whole copy already. */
    done?: boolean;
  };
};

/** What a PUT answered: its body and its ETag header (null without). */
export type PutResult = { text: string; etag: string | null };

export type Transport = {
  /** PUT `body` with progress. */
  put(
    url: string,
    headers: Record<string, string>,
    body: Blob,
    onProgress: (loaded: number) => void,
  ): Promise<PutResult>;
  /** A JSON call to the admin API. */
  api(method: string, path: string, body?: unknown): Promise<unknown>;
};

/**
 * The parts of a video's original the browser sent in one go, by upload
 * id, for its completion (completeUploadRequest): B2 then needs no
 * ListParts, which the upload key may not be allowed.
 */
export const sentParts = new Map<
  number,
  { partNumber: number; etag: string }[]
>();

/** Tries per part before the upload fails (the queue then starts over). */
const PART_TRIES = 3;

const withTries = async <T>(step: () => Promise<T>): Promise<T> => {
  for (let i = 1; ; i++) {
    try {
      return await step();
    } catch (err) {
      if (i >= PART_TRIES || (err instanceof UploadError && !err.retryable)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
};

/**
 * Send a prepared video: original, poster, playback copy. `onProgress`
 * gets the bytes sent of all three together, out of `totalBytes`.
 */
export const putVideo = async (
  id: number,
  init: VideoInitResult,
  original: Blob,
  prepared: Prepared,
  t: Transport,
  onProgress: (sent: number, total: number) => void,
): Promise<void> => {
  const kept = videoExtras(prepared);
  if (!kept) throw new UploadError("動画の準備がやり直しになりました", true);
  const posterSize = init.poster && kept.poster ? kept.poster.size : 0;
  const total = original.size + posterSize + kept.play.size;
  let sent = 0;
  /** Progress inside the current step, on top of `sent`. */
  const step = (loaded: number) => onProgress(sent + loaded, total);

  // 1. The original.
  if (init.original.mode === "done") {
    sent += original.size;
  } else if (init.original.mode === "single") {
    const { url, headers } = init.original;
    await withTries(() => t.put(url, headers, original, step));
    sent += original.size;
  } else {
    const o = init.original;
    const plan: PartPlan = { partSize: o.partSize, count: o.count };
    for (const n of o.done) {
      const r = partRange(plan, original.size, n);
      sent += r.end - r.start;
    }
    step(0);
    const todo = missingParts(plan, o.done);
    // The ETags of the parts sent now, for the completion (which then
    // needs no ListParts); only when this try sends every part.
    const etags = new Map<number, string>();
    for (let i = 0; i < todo.length; i += SIGN_BATCH) {
      const batch = todo.slice(i, i + SIGN_BATCH);
      const signed = (await t.api("POST", `/api/upload/${id}/parts`, {
        uploadId: o.uploadId,
        parts: batch,
      })) as { parts: { partNumber: number; url: string }[] };
      for (const { partNumber, url } of signed.parts) {
        const { start, end } = partRange(plan, original.size, partNumber);
        const put = await withTries(() =>
          t.put(url, {}, original.slice(start, end), step),
        );
        if (put.etag) etags.set(partNumber, put.etag);
        sent += end - start;
      }
    }
    if (o.done.length === 0 && etags.size === plan.count) {
      sentParts.set(
        id,
        [...etags]
          .sort(([a], [b]) => a - b)
          .map(([partNumber, etag]) => ({ partNumber, etag })),
      );
    }
  }

  // 2. The poster.
  if (init.poster && kept.poster) {
    const { url, headers } = init.poster;
    const poster = kept.poster;
    await withTries(() => t.put(url, headers, poster, step));
    sent += posterSize;
  }

  // 3. The playback copy, through the admin.
  const play = kept.play;
  const base = `/api/upload/${id}/play`;
  if (init.play.done) return;
  if (!init.play.multipart) {
    await withTries(() => t.put(base, {}, play, step));
    return;
  }
  const plan: PartPlan = {
    partSize: init.play.partSize,
    count: init.play.count,
  };
  // A retry goes on with the parts an earlier try sent (creating a new
  // upload would drop them: the admin aborts the one it had).
  if (!kept.r2) {
    const { uploadId } = (await t.api("POST", base, {
      action: "create",
    })) as { uploadId: string };
    kept.r2 = { uploadId, parts: new Map() };
  }
  const r2 = kept.r2;
  for (let n = 1; n <= plan.count; n++) {
    const { start, end } = partRange(plan, play.size, n);
    if (!r2.parts.has(n)) {
      let text: string;
      try {
        ({ text } = await withTries(() =>
          t.put(
            `${base}?uploadId=${encodeURIComponent(r2.uploadId)}&part=${n}`,
            {},
            play.slice(start, end),
            step,
          ),
        ));
      } catch (err) {
        // The upload is gone (409): the next try starts the copy over.
        if (err instanceof UploadError && /やり直され/.test(err.message)) {
          kept.r2 = undefined;
          throw new UploadError(err.message, true);
        }
        throw err;
      }
      const part = JSON.parse(text) as { partNumber: number; etag: string };
      r2.parts.set(part.partNumber, part.etag);
    }
    sent += end - start;
    step(0);
  }
  try {
    await t.api("POST", base, {
      action: "complete",
      uploadId: r2.uploadId,
      parts: [...r2.parts].map(([partNumber, etag]) => ({ partNumber, etag })),
    });
  } catch (err) {
    // Not completed: the next try makes a new upload.
    kept.r2 = undefined;
    throw err;
  }
};
