// Pictures of a camera (camera_image): where an uploaded one goes in the
// bucket, the order and its default, and when its object may be deleted.
// Pure (browser and server share it); covered by camera-image.spec.ts.

import {
  checkUploadLimits,
  resizeLimitsProblem,
  MAX_FILE_NAME_LEN,
  safeSegment,
  uploadContentType,
  type TargetResult,
} from "./upload";
import {
  cameraImageDir,
  isPhotoPicturePath,
  MAX_IMAGE_FILE_LEN,
  validateImageFile,
} from "./validate";

/**
 * Bucket path for a picture uploaded on the camera page: the camera's
 * folder `dir` (cameraImageDir) + the bucket-safe file name. Only the
 * file name counts (a dropped folder's subfolders are dropped).
 */
export const cameraPictureTarget = (
  dir: string,
  relativePath: string,
): TargetResult => {
  const raw = relativePath
    .split("/")
    .filter((s) => s !== "")
    .pop();
  if (!raw) return { ok: false, error: "ファイル名がありません" };
  const name = safeSegment(raw, MAX_FILE_NAME_LEN);
  if (!name) return { ok: false, error: `使えないファイル名です: ${raw}` };
  if (!uploadContentType(name, "")) {
    return { ok: false, error: "PNG / JPEG ではありません" };
  }
  const base = dir.endsWith("/") ? dir : `${dir}/`;
  const file = base + name;
  if (file.length > MAX_IMAGE_FILE_LEN) {
    return {
      ok: false,
      error: `パスが長すぎます（${MAX_IMAGE_FILE_LEN} 文字まで）`,
    };
  }
  if (!validateImageFile(file).ok || isPhotoPicturePath(file)) {
    return { ok: false, error: `使えないファイル名です: ${raw}` };
  }
  return { ok: true, file, dir: base.slice(0, -1) };
};

/** Whether `file` is directly in the folder of the camera `slug`. */
export const inCameraDir = (file: string, slug: string): boolean => {
  const dir = cameraImageDir(slug);
  return (
    file.startsWith(dir) &&
    file.length > dir.length &&
    !file.slice(dir.length).includes("/")
  );
};

const SHA256_RE = /^[0-9a-f]{64}$/;

export type CameraUploadInit = {
  file: string;
  size: number;
  contentType: string;
  sha256: string;
};

/**
 * Why a file cannot be a camera picture, or null: it must be within what
 * Image Transformations can resize, as a camera picture has no display
 * copy (its object is resized as it is).
 */
export const cameraPictureProblem = (f: {
  size: number;
  width?: number | null;
  height?: number | null;
}): string | null => checkUploadLimits(f) ?? resizeLimitsProblem(f);

/** Whether `file` is directly in some camera's folder (/camera/<slug>/x). */
const inAnyCameraDir = (file: string): boolean => {
  const parts = file.split("/");
  return parts.length === 4 && parts[1] === "camera" && parts[2] !== "";
};

/**
 * The upload request of a camera picture (POST /api/camera/<id>/image):
 * a path in the camera's own folder (`slug`; null: any camera's, for the
 * completion, whose path was given out before a slug change), a PNG /
 * JPEG within the limits of what Image Transformations can resize, and
 * its SHA-256.
 */
export const validateCameraUpload = (
  input: unknown,
  slug: string | null,
): { ok: true; init: CameraUploadInit } | { ok: false; error: string } => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "リクエストの形式が正しくありません" };
  }
  const o = input as Record<string, unknown>;
  const file = validateImageFile(o.file);
  if (
    !file.ok ||
    file.file !== o.file ||
    isPhotoPicturePath(file.file) ||
    !(slug === null ? inAnyCameraDir(file.file) : inCameraDir(file.file, slug))
  ) {
    return { ok: false, error: "保存先のパスが正しくありません" };
  }
  if (typeof o.size !== "number" || !Number.isInteger(o.size)) {
    return { ok: false, error: "ファイルの大きさが正しくありません" };
  }
  const dims: (number | null)[] = [];
  for (const v of [o.width, o.height]) {
    if (v == null) dims.push(null);
    else if (typeof v === "number" && Number.isInteger(v) && v > 0) {
      dims.push(v);
    } else return { ok: false, error: "画像の縦横の値が正しくありません" };
  }
  const refused = cameraPictureProblem({
    size: o.size,
    width: dims[0],
    height: dims[1],
  });
  if (refused) return { ok: false, error: refused };
  const contentType =
    typeof o.contentType === "string"
      ? uploadContentType(file.file, o.contentType)
      : null;
  if (!contentType) return { ok: false, error: "PNG / JPEG ではありません" };
  if (typeof o.sha256 !== "string" || !SHA256_RE.test(o.sha256)) {
    return { ok: false, error: "ハッシュ (SHA-256) の形式が正しくありません" };
  }
  return {
    ok: true,
    init: { file: file.file, size: o.size, contentType, sha256: o.sha256 },
  };
};

/**
 * The first of `candidates` (the name, then its numbered names) that no
 * row uses (`taken`), the bucket does not have (`exists`, asked for at
 * most `maxProbes` names: each is a request) and that `reserve` gets
 * (atomically, so two uploads at once never get the same name), or null.
 */
export const firstFreeName = async (
  candidates: readonly string[],
  taken: ReadonlySet<string>,
  exists: (file: string) => Promise<boolean>,
  maxProbes: number,
  reserve: (file: string) => Promise<boolean> = async () => true,
): Promise<string | null> => {
  let probes = 0;
  for (const c of candidates) {
    if (taken.has(c)) continue;
    if (probes >= maxProbes) return null;
    probes++;
    if (!(await exists(c)) && (await reserve(c))) return c;
  }
  return null;
};

/**
 * `ids` with `id` moved to `index` (clamped to the list), or null when it
 * is not in the list or already there.
 */
export const moveToIndex = (
  ids: readonly number[],
  id: number,
  index: number,
): number[] | null => {
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = Math.max(0, Math.min(ids.length - 1, index));
  if (to === from) return null;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
};

export type OrderOp = "up" | "down" | "default";

/**
 * The order after ↑ / ↓ or デフォルトにする (the first picture is the default:
 * the one the public camera list, its page's card and og use).
 */
export const orderAfter = (
  ids: readonly number[],
  id: number,
  op: OrderOp,
): number[] | null => {
  const from = ids.indexOf(id);
  if (from === -1) return null;
  return moveToIndex(
    ids,
    id,
    op === "default" ? 0 : op === "up" ? from - 1 : from + 1,
  );
};

/**
 * Where a picture dragged from `from` lands when dropped on the row at
 * `over`, on its upper (`after` false) or lower half.
 */
export const dropIndex = (from: number, over: number, after: boolean) => {
  const slot = after ? over + 1 : over;
  return slot > from ? slot - 1 : slot;
};

/** Whether `a` and `b` hold the same ids (an order of the same list). */
export const sameIds = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return (
    s.size === a.length &&
    new Set(b).size === b.length &&
    b.every((x) => s.has(x))
  );
};

/**
 * Whether a picture's object may be deleted from the bucket with it: it
 * is in a camera folder (pictures typed in by path may point anywhere)
 * and nothing else uses it (no photo's file, no other camera's picture;
 * like 完全に削除 of a photo, which keeps a camera picture's object).
 */
export const objectDeletable = (file: string, shared: boolean): boolean =>
  !shared && file.startsWith("/camera/");
