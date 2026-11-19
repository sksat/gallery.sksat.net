// Storage usage for the dashboard, from the sizes D1 has for each file
// (media.size). This is not what Backblaze B2 bills: B2 also counts old
// file versions and unfinished (large file) uploads, and averages the
// stored bytes over the month. Camera pictures (camera_image) have no size
// in D1 and are left out.

import type { Visibility } from "./types";

// Backblaze B2 storage pricing
// (https://www.backblaze.com/cloud-storage/pricing): $6 per TB-month, with
// the first 10 GB free. B2 counts in decimal units (1 GB = 10^9 bytes).
export const B2_PRICE_USD_PER_GB_MONTH = 0.006;
export const B2_FREE_STORAGE_BYTES = 10_000_000_000;

/** One GROUP BY row of storageQuery. */
export type StorageRow = {
  status: "uploading" | "ready";
  visibility: Visibility;
  /** First path segment of media.file ("/VRChat"), or "/" for the root. */
  folder: string;
  count: number;
  bytes: number;
  /** Rows in the group whose size is NULL (not counted in bytes). */
  unsized: number;
};

export type StorageSlice = { count: number; bytes: number };

export type StorageSummary = {
  /** Ready photos. */
  total: StorageSlice;
  byVisibility: Record<Visibility, StorageSlice>;
  /** Ready photos per top-level folder, largest first (then by name). */
  byFolder: ({ folder: string } & StorageSlice)[];
  /** Rows still uploading (their declared size). */
  uploading: StorageSlice;
  /** Ready photos without a size in D1. */
  unsized: number;
};

// Everything the card shows, in one query. The folder is the part of
// media.file before its second "/": "/VRChat/2023-12/a.png" -> "/VRChat".
export const STORAGE_SQL = `SELECT status, visibility,
  CASE WHEN instr(substr(file, 2), '/') > 0
    THEN substr(file, 1, instr(substr(file, 2), '/'))
    ELSE '/' END AS folder,
  COUNT(*) AS count,
  COALESCE(SUM(size), 0) AS bytes,
  COUNT(*) - COUNT(size) AS unsized
FROM media
GROUP BY status, visibility, folder`;

/**
 * The rows of STORAGE_SQL, plus the size of the D1 database itself, which
 * D1 reports with every query result (meta.size_after, bytes); null where
 * it is missing (the node:sqlite stand-in in tests).
 */
export const fetchStorageRows = async (
  db: D1Database,
): Promise<{ rows: StorageRow[]; dbBytes: number | null }> => {
  const r = await db.prepare(STORAGE_SQL).all<StorageRow>();
  const size = (r.meta as { size_after?: unknown } | undefined)?.size_after;
  return {
    rows: r.results,
    dbBytes: typeof size === "number" && Number.isFinite(size) ? size : null,
  };
};

const add = (s: StorageSlice, r: StorageSlice) => {
  s.count += r.count;
  s.bytes += r.bytes;
};

export const summarizeStorage = (rows: StorageRow[]): StorageSummary => {
  const zero = (): StorageSlice => ({ count: 0, bytes: 0 });
  const summary: StorageSummary = {
    total: zero(),
    byVisibility: { public: zero(), unlisted: zero(), private: zero() },
    byFolder: [],
    uploading: zero(),
    unsized: 0,
  };
  const folders = new Map<string, StorageSlice>();
  for (const r of rows) {
    const slice = { count: Number(r.count), bytes: Number(r.bytes) };
    if (r.status !== "ready") {
      add(summary.uploading, slice);
      continue;
    }
    add(summary.total, slice);
    add(summary.byVisibility[r.visibility], slice);
    const f = folders.get(r.folder) ?? zero();
    add(f, slice);
    folders.set(r.folder, f);
    summary.unsized += Number(r.unsized);
  }
  summary.byFolder = [...folders]
    .map(([folder, s]) => ({ folder, ...s }))
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0),
    );
  return summary;
};

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * Bytes as "999 B", "1.23 KB", "12.3 MB", "123 GB": base 1000 (decimal
 * units, as B2 and D1 count them), three significant digits from KB up.
 * (The uploader's formatUploadSize in upload.ts shows decimal and binary
 * units side by side.) Done by hand rather than via Intl so the output does not
 * depend on the runtime's ICU data.
 */
export const formatDecimalBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  // Pick the decimals from the rounded value, so 9.995 KB is "10.0 KB"
  // (not "10.00 KB"), and carry 999.96 KB into "1.00 MB".
  const digitsFor = (x: number) => (x < 10 ? 2 : x < 100 ? 1 : 0);
  let digits = digitsFor(v);
  digits = Math.min(digits, digitsFor(Number(v.toFixed(digits))));
  if (Number(v.toFixed(digits)) >= 1000 && i < UNITS.length - 1) {
    return `1.00 ${UNITS[i + 1]}`;
  }
  return `${v.toFixed(digits)} ${UNITS[i]}`;
};

/** Estimated monthly B2 storage charge for `bytes` stored all month. */
export const monthlyCostUsd = (bytes: number): number =>
  (Math.max(0, bytes - B2_FREE_STORAGE_BYTES) / 1e9) *
  B2_PRICE_USD_PER_GB_MONTH;

/** "$0.00", "$1.23"; a charge below a cent but above zero is "< $0.01". */
export const formatUsd = (usd: number): string =>
  usd > 0 && usd < 0.005 ? "< $0.01" : `$${usd.toFixed(2)}`;

/** Share of `part` in `whole` in percent, for bar widths (0–100). */
export const percentOf = (part: number, whole: number): number =>
  whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

/** `part` of a limit as text: "12.3%", "< 0.1%" for a sliver, "0%", over 100 as is. */
export const formatPercent = (part: number, whole: number): string => {
  if (!(whole > 0)) return "—";
  const p = (part / whole) * 100;
  if (p <= 0) return "0%";
  if (p < 0.1) return "< 0.1%";
  return `${p.toFixed(1)}%`;
};
