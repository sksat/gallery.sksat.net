// Browser side of the upload queue's dependencies: hashing with Web Crypto,
// the admin API, and the PUT to the bucket with XMLHttpRequest (fetch has
// no upload progress). Thin wrappers; the logic is in upload-queue.ts.

import { readPhotoMeta } from "./photo-meta";
import { vrchatTakenAt } from "./taken-at";
import { uploadContentType } from "./upload";
import {
  UploadError,
  type InitResult,
  type Prepared,
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
  const bytes = await f.blob.arrayBuffer();
  const [digest, meta] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes),
    readPhotoMeta(new Uint8Array(bytes)),
  ]);
  const { takenAt, ...stored } = meta;
  return {
    sha256: hex(digest),
    contentType,
    // The VRChat name is exact to the millisecond; then EXIF.
    timestamp: vrchatTakenAt(f.name) ?? takenAt,
    // Always sent, even empty: the server then knows the file was read.
    meta: stored,
  };
};

/** Statuses worth trying again (server trouble, expired URL, throttling). */
const retryableStatus = (status: number) =>
  status === 0 ||
  status === 403 ||
  status === 408 ||
  status === 429 ||
  status >= 500;

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
      data?.error ?? `HTTP ${res.status}`,
      // 403 here is Access or the Origin check, not an expired URL.
      res.status !== 403 && retryableStatus(res.status),
    );
  }
  return data;
};

export const initUploadRequest = (
  req: Parameters<QueueDeps<PickedFile>["init"]>[0],
): Promise<InitResult> =>
  api("POST", "/api/upload", req) as Promise<InitResult>;

export const completeUploadRequest = async (id: number): Promise<void> => {
  await api("POST", `/api/upload/${id}`);
};

/** PUT the file to the presigned URL, reporting bytes sent. */
export const putFile = (
  init: Extract<InitResult, { status: "upload" }>,
  f: PickedFile,
  onProgress: (loaded: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", init.url);
    for (const [k, v] of Object.entries(init.headers)) {
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
    xhr.send(f.blob);
  });

/** Everything the queue needs in a browser, except onChange. */
export const browserDeps = (
  onChange: (items: UploadItem[]) => void,
  concurrency: number,
): QueueDeps<PickedFile> => ({
  prepare: prepareFile,
  init: initUploadRequest,
  put: putFile,
  complete: completeUploadRequest,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  onChange,
  concurrency,
});
