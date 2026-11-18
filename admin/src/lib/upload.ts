// Pure rules for uploads (browser and server share them): which files can
// be uploaded, where they go in the bucket, and the init request's shape.
// Covered by upload.spec.ts.

import {
  MAX_FOLDER_NAME_LEN,
  normalizeDir,
  validateFolderPath,
} from "./folders";
import { normalizeStoredMeta, type StoredMeta } from "./photo-meta";
import type { MediaPlatform } from "./types";
import { validateImageFile } from "./validate";

/**
 * Largest original accepted, in bytes. Originals are up to ~40 MB (8K
 * PNGs); one S3 PUT may be 5 GB, so a single PUT per file is enough.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
  const v = validateImageFile(file);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, file, dir: targetDir };
};

/** VRChat's own screenshots: VRChat_2026-11-18_01-02-03.456_3840x2160.png */
// Current VRChat names put the resolution last
// (VRChat_2026-11-18_01-02-03.456_3840x2160.png); before late 2022 it came
// first (VRChat_3840x2160_2022-08-22_02-03-18.591.png).
export const VRCHAT_NAME_RE =
  /^VRChat_(?:\d+x\d+_)?(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)\.(\d{3})(?:_\d+x\d+)?\.png$/;

/**
 * Platform of a new photo: VRChat for anything under the top-level /VRChat/
 * folder or with VRChat's file names, else Real.
 */
export const guessPlatform = (file: string): MediaPlatform =>
  file.startsWith("/VRChat/") ||
  VRCHAT_NAME_RE.test(file.slice(file.lastIndexOf("/") + 1))
    ? "VRChat"
    : "Real";

export type UploadInit = {
  file: string;
  size: number;
  contentType: string;
  sha256: string;
  timestamp: string | null;
  /**
   * What the browser read from the file (photo-meta.ts): camera settings,
   * GPS position, VRChat world; each null when not found. Absent when the
   * browser did not read the file (the backfill reads it later).
   */
  meta?: StoredMeta;
};

const SHA256_RE = /^[0-9a-f]{64}$/;
// An ISO date-time with an explicit offset (what takenAt produces).
const TIMESTAMP_RE =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

/** The init request body (POST /api/upload). */
export const validateUploadInit = (
  input: unknown,
): { ok: true; init: UploadInit } | { ok: false; error: string } => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const o = input as Record<string, unknown>;
  const file = validateImageFile(o.file);
  if (!file.ok) return file;
  if (file.file !== o.file)
    return { ok: false, error: "file is not normalised" };
  const dir = file.file.slice(0, file.file.lastIndexOf("/")) || "/";
  if (dir !== "/") {
    const v = validateFolderPath(dir);
    if (!v.ok) return v;
  }
  if (
    typeof o.size !== "number" ||
    !Number.isInteger(o.size) ||
    o.size < 1 ||
    o.size > MAX_UPLOAD_BYTES
  ) {
    return {
      ok: false,
      error: `size must be 1..${MAX_UPLOAD_BYTES} bytes`,
    };
  }
  const contentType =
    typeof o.contentType === "string"
      ? uploadContentType(file.file, o.contentType)
      : null;
  if (!contentType) {
    return { ok: false, error: "contentType must match a .png / .jpg file" };
  }
  if (typeof o.sha256 !== "string" || !SHA256_RE.test(o.sha256)) {
    return { ok: false, error: "sha256 must be 64 lowercase hex digits" };
  }
  let timestamp: string | null = null;
  if (o.timestamp != null) {
    if (typeof o.timestamp !== "string" || !TIMESTAMP_RE.test(o.timestamp)) {
      return { ok: false, error: "timestamp must be an ISO date-time" };
    }
    timestamp = o.timestamp;
  }
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
      // Present (even empty) when the browser read the file.
      ...(o.meta !== undefined ? { meta } : {}),
    },
  };
};

/** "12.3 MB" style sizes for the progress rows. */
export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
