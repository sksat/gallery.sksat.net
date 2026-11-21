// Browser side of the upload queue's dependencies: hashing with Web Crypto,
// the admin API, and the PUT to the bucket with XMLHttpRequest (fetch has
// no upload progress). Thin wrappers; the logic is in upload-queue.ts.

import { cameraPictureProblem, cameraPictureTarget } from "./camera-image";
import { imageSize } from "./image-size";
import { markUnread } from "./read-state";
import { queueResize } from "./resize-client";
import {
  PHOTO_META_PARSER_DATE,
  readFileTool,
  readPhotoMeta,
} from "./photo-meta";
import { pickTakenAt } from "./taken-at";
import { COPY_READ_FAILED, makeDisplayCopy } from "./display-copy";
import {
  checkUploadLimits,
  isVideoType,
  MAX_UPLOAD_BYTES,
  needsDisplayCopy,
  NOT_ACCEPTED,
  uploadContentType,
} from "./upload";
import {
  prepareVideo,
  putVideo,
  sentParts,
  type PutResult,
  type Transport,
} from "./video-client";
import {
  UploadError,
  type InitResult,
  type Prepared,
  type PutTarget,
  type QueueDeps,
  type UploadItem,
  type UploadSource,
} from "./upload-queue";

/** A picked file with the path it was picked under. */
export type PickedFile = UploadSource & { blob: Blob };

export const fromFile = (file: File, relativePath?: string): PickedFile => ({
  name: file.name,
  relativePath: relativePath || file.webkitRelativePath || file.name,
  size: file.size,
  type: file.type,
  blob: file,
});

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

export const prepareFile = async (f: PickedFile): Promise<Prepared> => {
  const contentType = uploadContentType(f.name, f.type);
  if (!contentType) throw new UploadError(NOT_ACCEPTED, false);
  if (isVideoType(contentType)) return prepareVideo(f);
  const refused = checkUploadLimits({ size: f.size });
  if (refused) throw new UploadError(refused, false);
  let original: Awaited<ReturnType<typeof readOriginal>>;
  try {
    original = await readOriginal(f.blob);
  } catch (err) {
    // A file over the resize limits' 100 MB may be more than the tab can
    // hold (up to 5 GB are accepted): say so. Anything else as before.
    if (f.size <= MAX_UPLOAD_BYTES) throw err;
    console.error(`reading ${f.name} failed:`, err);
    throw new UploadError(COPY_READ_FAILED, false);
  }
  const { size, digest, meta, tool } = original;
  const { takenAt: _, dates, creatorTool, ...stored } = meta;
  // EXIF, then XMP, then the VRChat name (taken-at.ts).
  const taken = pickTakenAt(dates, f.name);
  // Larger than the image Worker can resize (rare): a display copy within
  // the limits goes up beside the original. Made once the original's bytes
  // are no longer held.
  const display = needsDisplayCopy({ size: f.size, ...size })
    ? await makeDisplayCopy(f.blob, {
        stored: size,
        orientation: stored.exif?.orientation,
        sha256: hex(digest),
      })
    : undefined;
  return {
    sha256: hex(digest),
    contentType,
    width: size?.width ?? null,
    height: size?.height ?? null,
    timestamp: taken?.at ?? null,
    ...(taken ? { timestampSource: taken.source } : {}),
    // Always sent, even empty: the server then knows the file was read.
    meta: stored,
    parserDate: PHOTO_META_PARSER_DATE,
    hints: { creatorTool, xmpSummary: tool.xmpSummary },
    ...(display ? { display } : {}),
  };
};

/**
 * The original's header size, SHA-256, metadata and writing tool, from its
 * bytes (held only here).
 */
const readOriginal = async (blob: Blob) => {
  const bytes = await blob.arrayBuffer();
  const size = imageSize(new Uint8Array(bytes));
  const [digest, meta, tool] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes),
    readPhotoMeta(new Uint8Array(bytes)),
    readFileTool(new Uint8Array(bytes)),
  ]);
  return { size, digest, meta, tool };
};

/** Statuses worth trying again (server trouble, expired URL, throttling). */
const retryableStatus = (status: number) =>
  status === 0 ||
  status === 403 ||
  status === 408 ||
  status === 429 ||
  status >= 500;

/**
 * What a failed admin API call means, for the panel: the route's own
 * (Japanese) message, or words for the generic answers (withErrorHandler's
 * 500, the Origin check, an Access page that is not JSON).
 */
export const apiProblem = (status: number, error?: string): string => {
  if (status === 403) return "権限がありません（ログインし直してください）";
  if (error && error !== "internal server error") return error;
  return status >= 500
    ? `サーバーでエラーが起きました（HTTP ${status}）`
    : `リクエストが受け付けられませんでした（HTTP ${status}）`;
};

const api = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new UploadError("ネットワークエラー", true);
  }
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!res.ok) {
    throw new UploadError(
      apiProblem(res.status, data?.error),
      // 403 here is Access or the Origin check, not an expired URL.
      res.status !== 403 && retryableStatus(res.status),
    );
  }
  return data;
};

export const initUploadRequest = (
  req: Parameters<QueueDeps<PickedFile>["init"]>[0],
): Promise<InitResult> => {
  // The display copy's facts, not its bytes.
  const { display, ...rest } = req;
  const body = display
    ? {
        ...rest,
        display: {
          size: display.size,
          width: display.width,
          height: display.height,
          sha256: display.sha256,
        },
      }
    : rest;
  return api("POST", "/api/upload", body) as Promise<InitResult>;
};

export const completeUploadRequest = async (id: number): Promise<void> => {
  // A video's original sent in parts: their ETags (video-client.ts).
  const parts = sentParts.get(id);
  await api("POST", `/api/upload/${id}`, parts ? { parts } : undefined);
  sentParts.delete(id);
  // A new photo: the background reader looks again (it may need reading).
  markUnread();
};

/**
 * PUT `body` with XHR (fetch has no upload progress); the response text
 * and ETag (B2's CORS rule exposes it).
 */
export const xhrPut = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (loaded: number) => void,
): Promise<PutResult> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          text: xhr.responseText,
          etag: xhr.getResponseHeader("ETag"),
        });
      } else {
        let error: string | undefined;
        try {
          error = (JSON.parse(xhr.responseText) as { error?: string }).error;
        } catch {
          // The bucket's XML, or nothing.
        }
        reject(
          new UploadError(
            error ?? `アップロード先が HTTP ${xhr.status} を返しました`,
            retryableStatus(xhr.status),
          ),
        );
      }
    };
    xhr.onerror = () => reject(new UploadError("ネットワークエラー", true));
    xhr.ontimeout = () => reject(new UploadError("タイムアウト", true));
    xhr.send(body);
  });

export const transport: Transport = { put: xhrPut, api };

/** PUT the file to the presigned URL (a video: all its objects). */
export const putFile = async (
  init: Extract<InitResult, { status: "upload" }>,
  f: PickedFile,
  onProgress: (loaded: number) => void,
  prepared: Prepared,
): Promise<void> => {
  if (init.video) {
    // Three uploads in one bar: scaled to the file's size.
    await putVideo(init.id, init.video, f.blob, prepared, transport, (s, t) =>
      onProgress(t === 0 ? 0 : Math.floor((s / t) * f.size)),
    );
    return;
  }
  if (!init.url || !init.headers) {
    throw new UploadError("アップロード先がありません", false);
  }
  await xhrPut(init.url, init.headers, f.blob, onProgress);
};

/** PUT `blob` to a presigned PUT target, reporting bytes sent. */
const putBlob = async (
  target: PutTarget,
  blob: Blob,
  onProgress: (loaded: number) => void,
): Promise<void> => {
  await xhrPut(target.url, target.headers, blob, onProgress);
};

/**
 * A camera picture's checks before it is sent: a PNG / JPEG within the
 * resize limits, and its SHA-256 (no photo metadata: it is not a photo).
 */
export const prepareCameraPicture = async (
  f: PickedFile,
): Promise<Prepared> => {
  const contentType = uploadContentType(f.name, f.type);
  if (!contentType) throw new UploadError("PNG / JPEG ではありません", false);
  const bytes = await f.blob.arrayBuffer();
  const size = imageSize(new Uint8Array(bytes));
  const refused = cameraPictureProblem({ size: f.size, ...size });
  if (refused) throw new UploadError(refused, false);
  return {
    sha256: hex(await crypto.subtle.digest("SHA-256", bytes)),
    contentType,
    width: size?.width ?? null,
    height: size?.height ?? null,
    timestamp: null,
  };
};

/**
 * The queue's dependencies for pictures of camera `cameraId`, uploaded
 * into its folder (`/camera/<slug>/`, cameraPictureTarget) through POST
 * /api/camera/<id>/image. One at a time, so two files with the same name
 * get numbered names rather than the same one.
 */
export const cameraPictureDeps = (
  cameraId: number,
  onChange: (items: UploadItem[]) => void,
): QueueDeps<PickedFile> => {
  const path = `/api/camera/${cameraId}/image`;
  /** What each init announced, by the id handed to the queue. */
  const pending = new Map<number, Record<string, unknown>>();
  let next = 1;
  return {
    target: cameraPictureTarget,
    prepare: prepareCameraPicture,
    init: async (req) => {
      const body = {
        file: req.file,
        size: req.size,
        contentType: req.contentType,
        sha256: req.sha256,
        width: req.width ?? null,
        height: req.height ?? null,
      };
      const r = (await api("POST", path, { step: "init", ...body })) as {
        file: string;
        url: string;
        headers: Record<string, string>;
      };
      const id = next++;
      pending.set(id, { ...body, file: r.file });
      return {
        status: "upload",
        id,
        file: r.file,
        url: r.url,
        headers: r.headers,
      };
    },
    put: putFile,
    // A camera picture has no display copy (prepare never makes one).
    putDisplay: (target, blob) => putBlob(target, blob, () => {}),
    complete: async (id) => {
      const body = pending.get(id);
      if (!body) throw new UploadError("アップロードし直してください", false);
      await api("POST", path, { step: "complete", ...body });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onChange,
    concurrency: 1,
  };
};

/** Everything the queue needs in a browser, except onChange. */
export const browserDeps = (
  onChange: (items: UploadItem[]) => void,
  concurrency: number,
): QueueDeps<PickedFile> => ({
  prepare: prepareFile,
  init: initUploadRequest,
  put: putFile,
  putDisplay: (target, blob) => putBlob(target, blob, () => {}),
  complete: async (id, f) => {
    await completeUploadRequest(id);
    // The new photo's resized copies, from the file in hand
    // (src/components/resize-maker.tsx).
    queueResize(id, f.blob);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  onChange,
  concurrency,
});
