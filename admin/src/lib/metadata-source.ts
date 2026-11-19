// Where each piece of a photo's metadata came from (media.metadata_source,
// migration 0008; covered by metadata-source.spec.ts), and the rule for
// reading an original again: a value read now replaces the stored one only
// when its source ranks at least as high, and a value entered by hand
// ('manual') is never replaced. Where it was taken keeps its own
// media.location_source ('exif' | 'manual').

import { isScanner, type StoredMeta } from "./photo-meta";

export const TAKEN_AT_SOURCES = [
  "manual",
  "exif",
  "xmp",
  "filename",
  "file_date",
] as const;
export type TakenAtSource = (typeof TAKEN_AT_SOURCES)[number];
export type FileSource = "manual" | "file";

export type MetadataSource = {
  taken_at?: TakenAtSource;
  exif?: FileSource;
  world?: FileSource;
  /** 0009: the スキャン機材 chosen (or cleared) by hand; never linked again. */
  digitized_with?: FileSource;
  /** The camera chosen (or cleared) by hand; never linked again. */
  camera?: FileSource;
};

/** Higher wins. A field with no recorded source ranks lowest (0). */
const RANK: Record<string, number> = {
  file_date: 1,
  filename: 2,
  xmp: 3,
  exif: 4,
  file: 4,
  manual: 100,
};

export const isTakenAtSource = (v: unknown): v is TakenAtSource =>
  (TAKEN_AT_SOURCES as readonly unknown[]).includes(v);

/** media.metadata_source read leniently (unknown values dropped). */
export const parseSources = (
  raw: string | null | undefined,
): MetadataSource => {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: MetadataSource = {};
  if (isTakenAtSource(o.taken_at)) out.taken_at = o.taken_at;
  for (const f of ["exif", "world", "digitized_with", "camera"] as const) {
    if (o[f] === "manual" || o[f] === "file") out[f] = o[f];
  }
  return out;
};

/** The JSON to store (null when nothing is known). */
export const serializeSources = (s: MetadataSource): string | null =>
  Object.keys(s).length > 0 ? JSON.stringify(s) : null;

/**
 * Whether a value read from `incoming` may replace what is stored (from
 * `stored`; undefined when not recorded). Never over 'manual' (even a
 * value cleared by hand stays cleared).
 */
export const mayReplace = (
  stored: string | undefined,
  incoming: string,
): boolean =>
  stored !== "manual" && (RANK[incoming] ?? 0) >= (RANK[stored ?? ""] ?? 0);

/** The columns of a row this decides on. */
export type SourcedRow = {
  timestamp: string | null;
  exif: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  world_id: string | null;
  world_name: string | null;
  /** 0015: who took it (usr_…, display name) and VRCX's extras (JSON). */
  photographer_id: string | null;
  photographer_name: string | null;
  vrcx: string | null;
  metadata_source: string | null;
  /** 0009: the file's own EXIF (admin only) and when it was digitised. */
  file_exif: string | null;
  digitized_at: string | null;
};

/** What reading the original gave. */
export type Reading = StoredMeta & {
  takenAt: { at: string; source: TakenAtSource } | null;
};

/**
 * The row after reading its original again: each field replaced where
 * the reading has a value and mayReplace allows it, else kept. Nothing
 * read is never a reason to clear a field.
 *
 * `firstRead`: the photo has not been read before (or was reset). Only
 * then does an empty location take one from the file: before 0008 a
 * location cleared by hand left no mark (location_source NULL), and the
 * file's own position must not come back over that.
 */
export const applyReading = (
  row: SourcedRow,
  r: Reading,
  firstRead = false,
): SourcedRow => {
  const src = parseSources(row.metadata_source);
  const out: SourcedRow = { ...row };
  if (r.takenAt && mayReplace(src.taken_at, r.takenAt.source)) {
    out.timestamp = r.takenAt.at;
    src.taken_at = r.takenAt.source;
  }
  if (r.exif && mayReplace(src.exif, "file")) {
    out.exif = JSON.stringify(r.exif);
    src.exif = "file";
  } else if (
    isScanner(r.fileExif?.make, r.fileExif?.model) &&
    src.exif !== "manual" &&
    row.exif !== null
  ) {
    // A scanner's file: an automatic exif came from the scanner (read
    // before 0009), so it goes. The one exception to "never clears".
    out.exif = null;
    delete src.exif;
  }
  if (r.world && mayReplace(src.world, "file")) {
    out.world_id = r.world.id;
    out.world_name = r.world.name;
    src.world = "file";
  }
  // Who took it and who was there are the file's alone (no edit sets
  // them): the latest reading, but never cleared by one that lacks them.
  if (r.photographer) {
    // A part the reading lacks is kept, unless it is another user's name.
    const id = r.photographer.id ?? row.photographer_id;
    out.photographer_id = id;
    out.photographer_name =
      r.photographer.name ??
      (id === row.photographer_id ? row.photographer_name : null);
  }
  if (r.vrcx) out.vrcx = JSON.stringify(r.vrcx);
  if (
    r.location &&
    (row.location_source === "exif" ||
      (row.location_source === null && firstRead))
  ) {
    out.latitude = r.location.latitude;
    out.longitude = r.location.longitude;
    out.location_source = "exif";
  }
  // What the file says is only ever the file's: always the latest reading.
  if (r.fileExif) out.file_exif = JSON.stringify(r.fileExif);
  if (r.digitizedAt) out.digitized_at = r.digitizedAt;
  out.metadata_source = serializeSources(src);
  return out;
};
