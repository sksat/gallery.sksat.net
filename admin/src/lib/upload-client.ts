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
  MAX_UPLOAD_BYTES,
  needsDisplayCopy,
  uploadContentType,
} from "./upload";
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
  if (!contentType) throw new UploadError("PNG / JPEG ではありません", false);
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
  await api("POST", `/api/upload/${id}`);
  // A new photo: the background reader looks again (it may need reading).
  markUnread();
};

/** PUT the file to the presigned URL, reporting bytes sent. */
export const putFile = (
  init: Extract<InitResult, { status: "upload" }>,
  f: PickedFile,
  onProgress: (loaded: number) => void,
): Promise<void> => putBlob(init, f.blob, onProgress);

/** PUT `blob` to a presigned URL, reporting bytes sent. */
const putBlob = (
  target: PutTarget,
  blob: Blob,
  onProgress: (loaded: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    for (const [k, v] of Object.entries(target.headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        reject(
          new UploadError(
            `アップロード先が HTTP ${xhr.status} を返しました`,
            retryableStatus(xhr.status),
          ),
        );
      }
    };
    xhr.onerror = () => reject(new UploadError("ネットワークエラー", true));
    xhr.ontimeout = () => reject(new UploadError("タイムアウト", true));
    xhr.send(blob);
  });

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

/**
 * The queue's dependencies for retouched versions of photo `mediaId`,
 * uploaded into `dir` (the photo's folder) through POST
 * /api/media/<id>/file. Read like originals (metadata, display copy); one
 * at a time.
 */
export const editFileDeps = (
  mediaId: number,
  onChange: (items: UploadItem[]) => void,
): QueueDeps<PickedFile> => {
  const path = `/api/media/${mediaId}/file`;
  return {
    prepare: prepareFile,
    init: (req) => {
      const { display, ...rest } = req;
      return api("POST", path, {
        step: "init",
        ...rest,
        ...(display
          ? {
              display: {
                size: display.size,
                width: display.width,
                height: display.height,
                sha256: display.sha256,
              },
            }
          : {}),
      }) as Promise<InitResult>;
    },
    put: putFile,
    putDisplay: (target, blob) => putBlob(target, blob, () => {}),
    complete: async (id) => {
      await api("POST", path, { step: "complete", id });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onChange,
    concurrency: 1,
  };
};

/**
 * Merge photo `from` into photo `into` as a retouched version of it
 * (POST /api/media/merge, its defaults); the alias is the undo's handle.
 */
export const mergeRequest = async (
  into: number,
  from: number,
): Promise<{ alias: string }> =>
  (await api("POST", "/api/media/merge", { into, from })) as { alias: string };

/** Undo a merge: the photo comes back. */
export const unmergeRequest = async (
  alias: string,
): Promise<{ id: number; path: string }> =>
  (await api("POST", "/api/media/merge", { undo: alias })) as {
    id: number;
    path: string;
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
