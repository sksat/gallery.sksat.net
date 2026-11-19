// Pure rules for uploads (browser and server share them): which files can
// be uploaded, where they go in the bucket, and the init request's shape.
// Covered by upload.spec.ts.

import {
  MAX_FOLDER_NAME_LEN,
  normalizeDir,
  validateFolderPath,
} from "./folders";
import { isTakenAtSource, type TakenAtSource } from "./metadata-source";
import {
  normalizeHints,
  normalizeStoredMeta,
  type FileHints,
  type StoredMeta,
} from "./photo-meta";
import { MAX_IMAGE_FILE_LEN, validateImageFile } from "./validate";

// What the image Worker can resize: Cloudflare Image Transformations
// refuses larger sources
// (https://developers.cloudflare.com/images/get-started/limits/), so a
// bigger photo could be stored but never shown. The uploader checks these
// before uploading (checkUploadLimits) and POST /api/upload again.

/**
 * Largest original accepted, in bytes: Cloudflare's 100 MB (decimal, as
 * the dashboard counts). Originals are up to ~40 MB (8K PNGs); one S3 PUT
 * may be 5 GB, so a single PUT per file is enough.
 */
export const MAX_UPLOAD_BYTES = 100_000_000;

/** Longest side, in pixels (Cloudflare's limit for PNG / JPEG sources). */
export const MAX_IMAGE_SIDE = 12_000;

/** Most pixels (width × height): Cloudflare's 100 megapixels. */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** 13000 → "13,000" (by hand: no dependence on the runtime's ICU). */
export const groupDigits = (n: number): string =>
  String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * `value` rounded up to a tenth, digits grouped, ".0" left out: rounding
 * up keeps a file just over a limit from reading as the limit itself.
 */
const ceilTenths = (value: number): number =>
  Math.ceil(Math.round(value * 1e6) / 1e5);

const tenthsUp = (value: number): string => {
  const tenths = ceilTenths(value);
  const frac = tenths % 10;
  return `${groupDigits(tenths / 10)}${frac ? `.${frac}` : ""}`;
};

/**
 * `bytes` in the largest unit of `base` (1000 or 1024) that fits, moving
 * up a unit when rounding up reaches it (999,999 B is "1 MB").
 */
const inUnits = (bytes: number, base: number, units: string[]): string => {
  let v = bytes;
  let i = 0;
  while (
    i < units.length - 1 &&
    (v >= base || (i > 0 && ceilTenths(v) >= base * 10))
  ) {
    v /= base;
    i++;
  }
  return i === 0
    ? `${groupDigits(v)} ${units[0]}`
    : `${tenthsUp(v)} ${units[i]}`;
};

/**
 * A file size for the upload panel, its sizes and its messages, in both
 * decimal and binary units: "123.4 MB（117.7 MiB）". Decimal is what
 * Cloudflare's 100 MB limit and B2 count; binary is what file managers
 * show. Each rounded up to a tenth.
 */
export const formatUploadSize = (bytes: number): string => {
  if (bytes < 1024) return `${groupDigits(bytes)} バイト`;
  return `${inUnits(bytes, 1000, ["B", "KB", "MB", "GB"])}（${inUnits(bytes, 1024, ["B", "KiB", "MiB", "GiB"])}）`;
};

/** Megapixels, rounded up to a tenth ("120 MP", "100.1 MP"). */
export const formatMegapixelsUp = (pixels: number): string =>
  `${tenthsUp(pixels / 1_000_000)} MP`;

/**
 * Why a file cannot be uploaded, in words for the upload panel, or null
 * when it is within the limits. `width` / `height` are null when unknown
 * (the header could not be read); then only the size is checked.
 */
export const checkUploadLimits = (f: {
  size: number;
  width?: number | null;
  height?: number | null;
}): string | null => {
  if (f.size <= 0) return "空のファイルです";
  if (f.size > MAX_UPLOAD_BYTES) {
    return `ファイルが大きすぎます：${formatUploadSize(f.size)}。上限は ${formatUploadSize(MAX_UPLOAD_BYTES)}です。`;
  }
  const { width, height } = f;
  if (width == null || height == null) return null;
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    return `画像が大きすぎます：${groupDigits(width)} × ${groupDigits(height)} px。1 辺 ${groupDigits(MAX_IMAGE_SIDE)} px までです。`;
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return `画素数が多すぎます：${formatMegapixelsUp(width * height)}。上限は ${formatMegapixelsUp(MAX_IMAGE_PIXELS)} です。`;
  }
  return null;
};

/** How long a presigned PUT stays valid (seconds). */
export const UPLOAD_URL_EXPIRES = 600;

/** Content types accepted, by extension (the image Worker serves these). */
const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export const UPLOAD_ACCEPT = "image/png,image/jpeg";

/** Lowercase extension of `name` ("A.JPG" → "jpg"), or "". */
const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/**
 * The content type a file is stored with, from its name, or null if it is
 * not a PNG/JPEG. The browser's `type` must agree when it is set (a
 * renamed HEIC is refused rather than stored as a broken JPEG).
 */
export const uploadContentType = (
  name: string,
  browserType: string,
): string | null => {
  const type = TYPES[extOf(name)];
  if (!type) return null;
  if (browserType && browserType !== type) return null;
  return type;
};

/**
 * One path segment as a bucket-safe name: characters outside
 * [A-Za-z0-9._-] become "_", runs of "_" collapse, a leading "." becomes
 * "_", and names longer than `maxLen` are cut (keeping the extension).
 * "" when nothing usable is left.
 */
export const safeSegment = (raw: string, maxLen: number): string => {
  let s = raw
    .normalize("NFC")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
  if (s.startsWith(".")) s = `_${s.slice(1)}`;
  if (/^_*$/.test(s)) return "";
  if (s.length <= maxLen) return s;
  const ext = extOf(s);
  if (!ext || ext.length >= maxLen - 1) return s.slice(0, maxLen);
  return `${s.slice(0, maxLen - ext.length - 1)}.${ext}`;
};

/** Longest file name (the last segment). */
export const MAX_FILE_NAME_LEN = 120;

export type TargetResult =
  { ok: true; file: string; dir: string } | { ok: false; error: string };

/**
 * Bucket path for a picked file: `dir` (the open folder) + `relativePath`,
 * which is the file name, or "Folder/sub/a.png" for a folder upload
 * (webkitRelativePath). Every segment is made bucket-safe; the folders
 * must pass validateFolderPath and the result validateImageFile.
 */
export const uploadTarget = (
  dir: string,
  relativePath: string,
): TargetResult => {
  const parts = relativePath.split("/").filter((s) => s !== "");
  const name = parts.pop();
  if (!name) return { ok: false, error: "ファイル名がありません" };
  const folders: string[] = [];
  for (const p of parts) {
    const s = safeSegment(p, MAX_FOLDER_NAME_LEN);
    if (!s) return { ok: false, error: `使えないフォルダ名です: ${p}` };
    folders.push(s);
  }
  const base = normalizeDir(dir);
  const targetDir =
    folders.length === 0
      ? base
      : `${base === "/" ? "" : base}/${folders.join("/")}`;
  if (targetDir !== "/") {
    const v = validateFolderPath(targetDir);
    if (!v.ok) return v;
  }
  const fileName = safeSegment(name, MAX_FILE_NAME_LEN);
  if (!fileName) return { ok: false, error: `使えないファイル名です: ${name}` };
  const file = `${targetDir === "/" ? "" : targetDir}/${fileName}`;
  // The camera page's validator speaks English; say it for the panel.
  if (!TYPES[extOf(fileName)]) {
    return { ok: false, error: "PNG / JPEG ではありません" };
  }
  if (file.length > MAX_IMAGE_FILE_LEN) {
    return {
      ok: false,
      error: `パスが長すぎます（${MAX_IMAGE_FILE_LEN} 文字まで）`,
    };
  }
  if (!validateImageFile(file).ok) {
    return { ok: false, error: `使えないファイル名です: ${name}` };
  }
  return { ok: true, file, dir: targetDir };
};

export type UploadInit = {
  file: string;
  size: number;
  contentType: string;
  sha256: string;
  timestamp: string | null;
  /** Where the timestamp came from (taken-at.ts); never "manual" here. */
  timestampSource?: Exclude<TakenAtSource, "manual">;
  /** The browser parser's PHOTO_META_PARSER_DATE. */
  parserDate?: string;
  /**
   * What the browser read from the file (photo-meta.ts): camera settings,
   * GPS position, VRChat world; each null when not found. Absent when the
   * browser did not read the file (the backfill reads it later).
   */
  meta?: StoredMeta;
  /** XMP CreatorTool, for the upload rules only. */
  hints?: FileHints;
  /**
   * The pixel size from the file's header (`width` / `height` of the
   * request, image-size.ts), when both were read: checked against the
   * limits and looked at by the upload rules, not stored.
   */
  dimensions?: { width: number; height: number };
};

const SHA256_RE = /^[0-9a-f]{64}$/;
// An ISO date-time with an explicit offset (what takenAt produces).
const TIMESTAMP_RE =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

/**
 * The init request body (POST /api/upload). It may also carry `width` /
 * `height` (from the file's header), which are checked against the limits
 * but not stored.
 */
export const validateUploadInit = (
  input: unknown,
): { ok: true; init: UploadInit } | { ok: false; error: string } => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "リクエストの形式が正しくありません" };
  }
  const o = input as Record<string, unknown>;
  const file = validateImageFile(o.file);
  if (!file.ok || file.file !== o.file) {
    return { ok: false, error: "保存先のパスが正しくありません" };
  }
  const dir = file.file.slice(0, file.file.lastIndexOf("/")) || "/";
  if (dir !== "/") {
    const v = validateFolderPath(dir);
    if (!v.ok) return v;
  }
  if (
    typeof o.size !== "number" ||
    !Number.isInteger(o.size) ||
    o.size < 0
  ) {
    return { ok: false, error: "ファイルの大きさが正しくありません" };
  }
  // Width and height: what the browser read from the header, if anything.
  const dims: (number | null)[] = [];
  for (const v of [o.width, o.height]) {
    if (v == null) dims.push(null);
    else if (typeof v === "number" && Number.isInteger(v) && v > 0) {
      dims.push(v);
    } else return { ok: false, error: "画像の縦横の値が正しくありません" };
  }
  const tooLarge = checkUploadLimits({
    size: o.size,
    width: dims[0],
    height: dims[1],
  });
  if (tooLarge) return { ok: false, error: tooLarge };
  const contentType =
    typeof o.contentType === "string"
      ? uploadContentType(file.file, o.contentType)
      : null;
  if (!contentType) {
    return { ok: false, error: "PNG / JPEG ではありません" };
  }
  if (typeof o.sha256 !== "string" || !SHA256_RE.test(o.sha256)) {
    return { ok: false, error: "ハッシュ (SHA-256) の形式が正しくありません" };
  }
  let timestamp: string | null = null;
  if (o.timestamp != null) {
    if (typeof o.timestamp !== "string" || !TIMESTAMP_RE.test(o.timestamp)) {
      return { ok: false, error: "撮影日時の形式が正しくありません" };
    }
    timestamp = o.timestamp;
  }
  // An automatic source only (lenient: anything else is left out).
  const timestampSource =
    timestamp !== null &&
    isTakenAtSource(o.timestampSource) &&
    o.timestampSource !== "manual"
      ? o.timestampSource
      : undefined;
  // Lenient: what is malformed is left out rather than refusing the file.
  const meta = normalizeStoredMeta(o.meta);
  return {
    ok: true,
    init: {
      file: file.file,
      size: o.size,
      contentType,
      sha256: o.sha256,
      timestamp,
      ...(timestampSource ? { timestampSource } : {}),
      ...(typeof o.parserDate === "string" && o.parserDate.length <= 40
        ? { parserDate: o.parserDate }
        : {}),
      // Present (even empty) when the browser read the file.
      ...(o.meta !== undefined ? { meta } : {}),
      ...(o.hints !== undefined ? { hints: normalizeHints(o.hints) } : {}),
      ...(dims[0] != null && dims[1] != null
        ? { dimensions: { width: dims[0], height: dims[1] } }
        : {}),
    },
  };
};
