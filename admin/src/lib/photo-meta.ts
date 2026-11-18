// Metadata embedded in an original, read without dependencies (covered by
// photo-meta.spec.ts). Used by the uploader in the browser (the whole file
// is in memory for its hash anyway) and by the backfill, which only has
// the first and last bytes of each original (the image Worker's
// AdminImage.bytes).
//
// - EXIF (TIFF IFDs): a JPEG's APP1 "Exif" segment or a PNG's eXIf chunk.
//   Camera (Make, Model, LensModel), exposure (FNumber, ExposureTime,
//   ISO, FocalLength), Orientation, DateTimeOriginal + OffsetTimeOriginal
//   and the GPS position.
// - XMP: a PNG's iTXt chunk "XML:com.adobe.xmp" or a JPEG's APP1 XMP
//   segment. VRChat writes the world it was taken in there (vrc:WorldID,
//   vrc:WorldDisplayName) and the photographer (vrc:AuthorID).
//
// Everything is read leniently: a value that is missing, malformed or out
// of range is left out, and a truncated or corrupt file yields whatever
// was read before the damage.

/**
 * When this parser last learned to find something new: photos read before
 * it are read again (backfill.ts). Bump it with every such change; a date
 * slightly ahead of the deploy is fine. (2026-11-19: the XMP CreateDate,
 * scanners' dates; 2026-11-20: the file's own EXIF and the scan time
 * apart from the shooting information; 2026-11-21: a reading links the
 * camera or scanner the file names, creating its camera row, device.ts.)
 */
export const PHOTO_META_PARSER_DATE = "2026-11-21T00:00:00.000Z";

/** Offset assumed when a date in the file has none (cameras on JST). */
export const DEFAULT_OFFSET = "+09:00";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO date-time from parts, or null if they are not a real date-time. */
export const isoDateTime = (
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number | null,
  offset: string,
): string | null => {
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    y < 1900 ||
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d ||
    t.getUTCHours() !== h ||
    t.getUTCMinutes() !== mi ||
    t.getUTCSeconds() !== s
  ) {
    return null;
  }
  const frac = ms === null ? "" : `.${pad(ms, 3)}`;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${frac}${offset}`;
};

const EXIF_DATE_RE = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/;
const OFFSET_RE = /^[+-]\d\d:\d\d$/;

/** EXIF "YYYY:MM:DD HH:MM:SS" + optional "+HH:MM" as ISO, else null. */
export const exifDateToIso = (
  value: string,
  offset: string | null,
): string | null => {
  const m = EXIF_DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const off = offset && OFFSET_RE.test(offset) ? offset : DEFAULT_OFFSET;
  return isoDateTime(y, mo, d, h, mi, s, null, off);
};

/**
 * media.exif (migration 0005): a copy of the API Worker's ExifJSON
 * (workers/api/src/metadata.ts), which reads it back with parseExif.
 */
export type ExifJSON = {
  make?: string;
  model?: string;
  lens?: string;
  focal_length_mm?: number;
  f_number?: number;
  /** As photographers write it: "1/250", "2", "0.5". */
  exposure_time?: string;
  iso?: number;
  /** EXIF Orientation, 1–8. */
  orientation?: number;
  /** DateTimeOriginal: ISO 8601, with the offset when the file has one. */
  taken_at_original?: string;
};

/**
 * media.file_exif (migration 0009, admin only): the file's own EXIF as
 * read, whatever made it: a camera's, or a scanner's for a photo
 * digitised from an analog original. Never public.
 */
export type FileExifJSON = ExifJSON & {
  software?: string;
  /** IFD0 DateTime (when the file was written), ISO. */
  date_time?: string;
};

export type WorldMeta = {
  /** wrld_… */
  id: string | null;
  name: string | null;
  /** usr_…, admin only. */
  authorId: string | null;
};

/**
 * The times a file records, each an ISO date-time with an offset (JST
 * when the file has none), to the millisecond. Pick with takenAtOf
 * (taken-at.ts adds the VRChat file name).
 */
export type FileDates = {
  /** EXIF DateTimeOriginal (+ OffsetTimeOriginal). */
  exifOriginal: string | null;
  /** XMP xmp:CreateDate, else exif:DateTimeOriginal / tiff:DateTime in XMP. */
  xmp: string | null;
  /** EXIF IFD0 DateTime (when the file was last written). */
  exifDateTime: string | null;
};

export type PhotoMeta = {
  /** When it was taken, from the file alone (takenAtOf(dates)). */
  takenAt: string | null;
  dates: FileDates;
  /**
   * The shooting information: the camera's EXIF. Null for a file a
   * scanner wrote (its EXIF describes the scanner, not the shot).
   */
  exif: ExifJSON | null;
  /** The file's own EXIF, whatever wrote it (admin only). */
  fileExif: FileExifJSON | null;
  /** When a scanner digitised the analog original (its EXIF date). */
  digitizedAt: string | null;
  /** WGS 84 degrees from the GPS IFD. */
  location: { latitude: number; longitude: number } | null;
  world: WorldMeta | null;
  /** XMP xmp:CreatorTool ("VRChat", "Adobe Lightroom …"). */
  creatorTool: string | null;
  /** Pixel size as stored (before the EXIF orientation is applied). */
  dimensions: { width: number; height: number } | null;
};

// --- TIFF / EXIF ----------------------------------------------------------

const T = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  dateTime: 0x0132,
  software: 0x0131,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  focalLength: 0x920a,
  lensModel: 0xa434,
  gpsLatRef: 0x0001,
  gpsLat: 0x0002,
  gpsLonRef: 0x0003,
  gpsLon: 0x0004,
} as const;

const MAX_IFD_ENTRIES = 512;
const MAX_ASCII = 128;
const MAX_VALUES = 4;

type Rational = [number, number];
type TagValue = string | number[] | Rational[];

/** Bytes per value of the TIFF types read here. */
const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  10: 8,
  // IFD (an offset, like LONG): some writers use it for sub-IFD pointers.
  13: 4,
};

/**
 * One IFD's values by tag (only the types above). Throws when the IFD
 * itself is out of range; an IFD cut short keeps the entries before the
 * cut, and a value past the end only loses that tag.
 */
const readIfd = (
  view: DataView,
  tiff: number,
  offset: number,
  little: boolean,
): Map<number, TagValue> => {
  const out = new Map<number, TagValue>();
  const at = tiff + offset;
  // Bounded work on a crafted file: real IFDs have a few dozen entries.
  const count = Math.min(view.getUint16(at, little), MAX_IFD_ENTRIES);
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    const tag = view.getUint16(e, little);
    const type = view.getUint16(e + 2, little);
    const n = view.getUint32(e + 4, little);
    const size = TYPE_SIZE[type];
    if (!size || n === 0) continue;
    const start = n * size <= 4 ? e + 8 : tiff + view.getUint32(e + 8, little);
    try {
      if (type === 2 || type === 7) {
        // ASCII (UNDEFINED read the same: OffsetTime is ASCII, but be
        // lenient). Many writers put UTF-8 there: decode it as such.
        const bytes: number[] = [];
        for (let j = 0; j < Math.min(n, MAX_ASCII); j++) {
          const c = view.getUint8(start + j);
          if (c === 0) break;
          bytes.push(c);
        }
        out.set(tag, utf8(Uint8Array.from(bytes)));
      } else if (type === 5 || type === 10) {
        const vals: Rational[] = [];
        for (let j = 0; j < Math.min(n, MAX_VALUES); j++) {
          const p = start + j * 8;
          vals.push(
            type === 5
              ? [view.getUint32(p, little), view.getUint32(p + 4, little)]
              : [view.getInt32(p, little), view.getInt32(p + 4, little)],
          );
        }
        out.set(tag, vals);
      } else {
        const vals: number[] = [];
        for (let j = 0; j < Math.min(n, MAX_VALUES); j++) {
          const p = start + j * size;
          vals.push(
            size === 1
              ? view.getUint8(p)
              : size === 2
                ? view.getUint16(p, little)
                : view.getUint32(p, little),
          );
        }
        out.set(tag, vals);
      }
    } catch {
      // A value pointing past the end (truncated file): skip that tag.
    }
  }
  return out;
};

const str = (m: Map<number, TagValue>, tag: number): string | undefined => {
  const v = m.get(tag);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s === "" ? undefined : s;
};

const int = (m: Map<number, TagValue>, tag: number): number | undefined => {
  const v = m.get(tag);
  return Array.isArray(v) && typeof v[0] === "number" ? v[0] : undefined;
};

const rationals = (m: Map<number, TagValue>, tag: number): number[] => {
  const v = m.get(tag);
  if (!Array.isArray(v) || !Array.isArray(v[0])) return [];
  return (v as Rational[]).map(([a, b]) => (b === 0 ? NaN : a / b));
};

const rational = (
  m: Map<number, TagValue>,
  tag: number,
): number | undefined => {
  const [v] = rationals(m, tag);
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
};

/** Up to `digits` decimals, without float noise (2.8000000001 → 2.8). */
const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * An exposure time as photographers write it: "1/250" below a second
 * (when 1/t is close to a whole number), else seconds ("0.3", "2", "2.5").
 */
export const formatExposure = (seconds: number): string | null => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 1) {
    const inv = 1 / seconds;
    if (Math.abs(inv - Math.round(inv)) < 0.05 * inv && inv >= 2) {
      return `1/${Math.round(inv)}`;
    }
  }
  return String(round(seconds, 4));
};

/** "YYYY:MM:DD HH:MM:SS" (+ offset) as ISO, with the offset only if known. */
const originalIso = (value: string, offset: string | undefined) => {
  if (offset && OFFSET_RE.test(offset)) {
    return exifDateToIso(value, offset) ?? undefined;
  }
  const iso = exifDateToIso(value, "+00:00");
  return iso ? iso.slice(0, -6) : undefined;
};

/** Degrees from the GPS IFD's (deg, min, sec) and N/S or E/W. */
const gpsCoord = (
  m: Map<number, TagValue>,
  tag: number,
  refTag: number,
  max: number,
): number | null => {
  const [d, mi = 0, s = 0] = rationals(m, tag);
  const ref = str(m, refTag)?.toUpperCase();
  // Without its N/S or E/W the sign is unknown: no position at all rather
  // than one on the wrong side of the world.
  if (ref !== "N" && ref !== "S" && ref !== "E" && ref !== "W") return null;
  if (d === undefined || ![d, mi, s].every(Number.isFinite)) return null;
  const abs = d + mi / 60 + s / 3600;
  if (abs > max) return null;
  const v = ref === "S" || ref === "W" ? -abs : abs;
  return round(v, 7) + 0;
};

type TiffMeta = Pick<
  PhotoMeta,
  "exif" | "fileExif" | "digitizedAt" | "location"
> & {
  exifOriginal: string | null;
  exifDateTime: string | null;
};

const NO_TIFF: TiffMeta = {
  exif: null,
  fileExif: null,
  digitizedAt: null,
  location: null,
  exifOriginal: null,
  exifDateTime: null,
};

/**
 * Whether EXIF Make/Model name a scanner rather than a camera: the file
 * was digitised from an analog original (a negative or slide, an instant
 * photo, a glass plate, a print), so its EXIF and dates describe the
 * scan, not the shot. A short list of the common lab, film and flatbed
 * scanners, and any make or model with "scanner" in it.
 * migrations/0008_metadata_source.sql and 0009_file_exif.sql have the
 * same list in SQL (migrations.spec.ts checks they agree).
 */
export const isScanner = (
  make: string | undefined,
  model: string | undefined,
): boolean => {
  const mk = make ?? "";
  const md = model ?? "";
  return (
    /noritsu|plustek|pacific image/i.test(mk) ||
    // Fuji Frontier (SP-500/1500/2000/3000, LP-…).
    (/fuji/i.test(mk) && /^(SP|LP)-?\d|frontier/i.test(md)) ||
    /frontier|pakon|flextight|coolscan|^LS-\d|perfection|opticfilm|^QSS-|^HS-1800|^EZ ?controller/i.test(
      md,
    ) ||
    // Generic ones: e.g. make "GCMC", model "Scanner" (a film scanner
    // whose clock was never set, dating every scan 2021-01-01).
    /scanner/i.test(md) ||
    /scanner/i.test(mk)
  );
};

/** What a TIFF/EXIF block starting at `tiff` holds. Throws on bad headers. */
const fromTiff = (view: DataView, tiff: number): TiffMeta => {
  const order = view.getUint16(tiff, false);
  if (order !== 0x4949 && order !== 0x4d4d) return NO_TIFF;
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return NO_TIFF;
  const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
  const sub = (tag: number) => {
    const at = int(ifd0, tag);
    if (at === undefined) return new Map<number, TagValue>();
    try {
      return readIfd(view, tiff, at, little);
    } catch {
      return new Map<number, TagValue>();
    }
  };
  const ex = sub(T.exifIfd);
  const gps = sub(T.gpsIfd);

  const exif: ExifJSON = {};
  const make = str(ifd0, T.make);
  const model = str(ifd0, T.model);
  const lens = str(ex, T.lensModel);
  if (make) exif.make = make;
  if (model) exif.model = model;
  if (lens) exif.lens = lens;
  const focal = rational(ex, T.focalLength);
  if (focal !== undefined) exif.focal_length_mm = round(focal, 2);
  const f = rational(ex, T.fNumber);
  if (f !== undefined) exif.f_number = round(f, 2);
  const t = rational(ex, T.exposureTime);
  const exposure = t === undefined ? null : formatExposure(t);
  if (exposure) exif.exposure_time = exposure;
  const iso = int(ex, T.iso);
  if (iso !== undefined && iso > 0) exif.iso = iso;
  const orientation = int(ifd0, T.orientation);
  if (orientation !== undefined && orientation >= 1 && orientation <= 8) {
    exif.orientation = orientation;
  }
  const original = str(ex, T.dateTimeOriginal);
  const offset = str(ex, T.offsetTimeOriginal);
  if (original) {
    const v = originalIso(original, offset);
    if (v) exif.taken_at_original = v;
  }

  const lat = gpsCoord(gps, T.gpsLat, T.gpsLatRef, 90);
  const lon = gpsCoord(gps, T.gpsLon, T.gpsLonRef, 180);
  // (0, 0) is what some devices write without a fix.
  const location =
    lat !== null && lon !== null && !(lat === 0 && lon === 0)
      ? { latitude: lat, longitude: lon }
      : null;

  const dateTime = str(ifd0, T.dateTime);
  const software = str(ifd0, T.software);
  const any = Object.keys(exif).length > 0;
  const fileExif: FileExifJSON = { ...exif };
  if (software) fileExif.software = cut(software, MAX_META_TEXT);
  const dateTimeIso = dateTime ? exifDateToIso(dateTime, null) : null;
  if (dateTimeIso) fileExif.date_time = dateTimeIso;
  // A scanner's EXIF and dates are the scan's: the file's own EXIF and the
  // scan time, never the shooting information or the taken-at.
  const scanner = isScanner(make, model);
  const originalAt = original ? exifDateToIso(original, offset ?? null) : null;

  return {
    exif: any && !scanner ? exif : null,
    fileExif: Object.keys(fileExif).length > 0 ? fileExif : null,
    digitizedAt: scanner ? (originalAt ?? dateTimeIso) : null,
    location,
    exifOriginal: scanner ? null : originalAt,
    exifDateTime: scanner ? null : dateTimeIso,
  };
};

// --- XMP ------------------------------------------------------------------

/** Longest text kept in any field. */
export const MAX_META_TEXT = 200;

/** At most `max` characters, never splitting a surrogate pair. */
const cut = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const end = /[\uD800-\uDBFF]/.test(s[max - 1]) ? max - 1 : max;
  return s.slice(0, end);
};

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x")
      ? parseInt(k.slice(2), 16)
      : parseInt(k.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

/**
 * One XMP property (`prefix:Name`), written as an attribute
 * (vrc:WorldID="…") or an element (<vrc:WorldID>…</vrc:WorldID>).
 */
const xmpValue = (xmp: string, name: string): string | null => {
  const attr = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(
    xmp,
  );
  const elem = new RegExp(
    `<${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`,
  ).exec(xmp);
  const raw = attr?.[1] ?? attr?.[2] ?? elem?.[1] ?? elem?.[2];
  if (raw === undefined) return null;
  const v = (elem?.[1] !== undefined ? raw : decodeEntities(raw)).trim();
  return v === "" ? null : cut(v, MAX_META_TEXT);
};

const XMP_DATE_RE =
  /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?(Z|[+-]\d\d:\d\d)?$/;

/**
 * An XMP date ("2026-11-02T11:31:36.9591864+09:00") as stored: cut to the
 * millisecond (not rounded, so it never moves to the next second), the
 * offset kept ("Z" as +00:00, none as JST). Null for anything else,
 * including XMP's date-only forms.
 */
export const xmpDateToIso = (value: string): string | null => {
  const m = XMP_DATE_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", frac, off] = m;
  const ms =
    frac === undefined ? null : Number(frac.slice(0, 3).padEnd(3, "0"));
  const offset =
    off === undefined ? DEFAULT_OFFSET : off === "Z" ? "+00:00" : off;
  return isoDateTime(+y, +mo, +d, +h, +mi, +s, ms, offset);
};

/**
 * When the photo was taken by its XMP: xmp:CreateDate (VRChat writes it,
 * with the real offset and sub-second time), else the EXIF / TIFF dates
 * copied into XMP.
 */
export const xmpTakenAt = (xmp: string): string | null => {
  for (const name of [
    "xmp:CreateDate",
    "exif:DateTimeOriginal",
    "tiff:DateTime",
  ]) {
    const v = xmpValue(xmp, name);
    const iso = v === null ? null : xmpDateToIso(v);
    if (iso) return iso;
  }
  return null;
};

/**
 * The taken-at time among a file's own dates: EXIF DateTimeOriginal, then
 * the XMP date, then EXIF DateTime. (taken-at.ts puts the VRChat file name
 * before DateTime.)
 */
export const takenAtOf = (d: FileDates): string | null =>
  d.exifOriginal ?? d.xmp ?? d.exifDateTime;

const WORLD_ID_RE = /^wrld_[0-9A-Za-z-]+$/;
const USER_ID_RE = /^usr_[0-9A-Za-z-]+$/;

/** The VRChat world in an XMP packet, or null. */
export const worldFromXmp = (xmp: string): WorldMeta | null => {
  const id = xmpValue(xmp, "vrc:WorldID");
  const name = xmpValue(xmp, "vrc:WorldDisplayName");
  const author = xmpValue(xmp, "vrc:AuthorID");
  const world = {
    id: id && WORLD_ID_RE.test(id) ? id : null,
    name,
    authorId: author && USER_ID_RE.test(author) ? author : null,
  };
  return world.id || world.name ? world : null;
};

/** The app that wrote the file (xmp:CreatorTool), or null. */
export const creatorToolFromXmp = (xmp: string): string | null =>
  xmpValue(xmp, "xmp:CreatorTool");

// --- Containers -----------------------------------------------------------

const XMP_KEYWORD = "XML:com.adobe.xmp";
const JPEG_XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return s;
};
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/** What was found in a file's bytes before decoding anything. */
type Found = {
  /** Offset of each TIFF block (EXIF). */
  tiff: number[];
  /** XMP packets, as text. */
  xmp: string[];
  /** zlib-compressed XMP (a PNG iTXt with its compression flag). */
  compressedXmp: Uint8Array[];
  /** From a PNG's IHDR or a JPEG's start-of-frame. */
  dimensions: { width: number; height: number } | null;
};

const newFound = (): Found => ({
  tiff: [],
  xmp: [],
  compressedXmp: [],
  dimensions: null,
});

const size = (width: number, height: number) =>
  width > 0 && height > 0 ? { width, height } : null;

/** A PNG iTXt chunk's text if it is XMP. */
const pngItxt = (data: Uint8Array, found: Found) => {
  const kwEnd = data.indexOf(0);
  if (kwEnd < 0 || latin1(data.subarray(0, kwEnd)) !== XMP_KEYWORD) return;
  const compressed = data[kwEnd + 1] === 1;
  // Language tag and translated keyword, each NUL-terminated.
  const langEnd = data.indexOf(0, kwEnd + 3);
  const transEnd = langEnd < 0 ? -1 : data.indexOf(0, langEnd + 1);
  if (transEnd < 0) return;
  const text = data.subarray(transEnd + 1);
  if (compressed) found.compressedXmp.push(text);
  else found.xmp.push(utf8(text));
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isPng = (b: Uint8Array) =>
  b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);

export const isJpeg = (b: Uint8Array) =>
  b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * Walk a PNG's chunks (headers only; IDAT data is skipped over) until IEND
 * or the end of the bytes. `sawIdat` says whether it got that far, i.e.
 * whether the metadata before the image data is all there.
 */
const scanPng = (b: Uint8Array, found: Found): { complete: boolean } => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  while (p + 8 <= b.length) {
    const len = view.getUint32(p, false);
    const type = latin1(b.subarray(p + 4, p + 8));
    const data = p + 8;
    if (type === "IEND") return { complete: true };
    if (data + len > b.length) return { complete: false };
    if (type === "IHDR" && len >= 8) {
      found.dimensions = size(
        view.getUint32(data, false),
        view.getUint32(data + 4, false),
      );
    } else if (type === "eXIf") {
      // Some writers keep JPEG's "Exif\0\0" in front of the TIFF block.
      const prefixed = latin1(b.subarray(data, data + 6)) === "Exif\0\0";
      found.tiff.push(prefixed ? data + 6 : data);
    } else if (type === "iTXt") pngItxt(b.subarray(data, data + len), found);
    p = data + len + 4;
  }
  return { complete: false };
};

/** A JPEG's APP1 segments (EXIF, XMP) up to the start of scan. */
const scanJpeg = (b: Uint8Array, found: Found) => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return;
    const marker = b[p + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return;
    const len = view.getUint16(p + 2, false);
    const data = p + 4;
    // Start of frame (SOF0–SOF15 except DHT, JPG and DAC): precision,
    // height, width.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      data + 5 <= b.length
    ) {
      found.dimensions = size(
        view.getUint16(data + 3, false),
        view.getUint16(data + 1, false),
      );
    }
    if (marker === 0xe1 && data + len - 2 <= b.length) {
      const seg = b.subarray(data, data + len - 2);
      if (latin1(seg.subarray(0, 6)) === "Exif\0\0") found.tiff.push(data + 6);
      else if (latin1(seg.subarray(0, JPEG_XMP_NS.length)) === JPEG_XMP_NS) {
        found.xmp.push(utf8(seg.subarray(JPEG_XMP_NS.length)));
      }
    }
    p += 2 + len;
  }
};

/**
 * iTXt XMP chunks anywhere in `b` (the last bytes of a PNG, where chunk
 * boundaries are unknown): found by their type and keyword, then read by
 * the length before them.
 */
const scanPngTail = (b: Uint8Array, found: Found) => {
  const needle = `iTXt${XMP_KEYWORD}\0`;
  const text = latin1(b);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    // A hit without its length field before it (cut off) is skipped.
    if (i < 4) continue;
    const len = view.getUint32(i - 4, false);
    if (i + 4 + len <= b.length) pngItxt(b.subarray(i + 4, i + 4 + len), found);
  }
};

const find = (head: Uint8Array, tail?: Uint8Array): Found => {
  const found = newFound();
  try {
    if (isPng(head)) {
      const { complete } = scanPng(head, found);
      if (!complete && tail) scanPngTail(tail, found);
    } else if (isJpeg(head)) {
      scanJpeg(head, found);
    }
  } catch {
    // Malformed: keep what was found.
  }
  return found;
};

/**
 * Whether the last bytes of a file are worth reading too: a PNG whose
 * first bytes end before IEND with no XMP found in them (writers that put
 * text chunks after the image data).
 */
export const needsTail = (head: Uint8Array): boolean => {
  if (!isPng(head)) return false;
  const found = newFound();
  try {
    const { complete } = scanPng(head, found);
    return !complete && found.xmp.length + found.compressedXmp.length === 0;
  } catch {
    return false;
  }
};

const decode = (head: Uint8Array, found: Found, xmp: string[]): PhotoMeta => {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let tiffMeta: TiffMeta = NO_TIFF;
  for (const at of found.tiff) {
    try {
      tiffMeta = fromTiff(view, at);
      break;
    } catch {
      // Truncated: try the next block, if any.
    }
  }
  let world: WorldMeta | null = null;
  for (const x of xmp) {
    world = worldFromXmp(x);
    if (world) break;
  }
  // A scanner's XMP dates are the scan's too.
  const scanner = isScanner(tiffMeta.fileExif?.make, tiffMeta.fileExif?.model);
  let xmpDate: string | null = null;
  for (const x of scanner ? [] : xmp) {
    xmpDate = xmpTakenAt(x);
    if (xmpDate) break;
  }
  const dates: FileDates = {
    exifOriginal: tiffMeta.exifOriginal,
    xmp: xmpDate,
    exifDateTime: tiffMeta.exifDateTime,
  };
  let creatorTool: string | null = null;
  for (const x of xmp) {
    creatorTool = creatorToolFromXmp(x);
    if (creatorTool) break;
  }
  return {
    takenAt: takenAtOf(dates),
    dates,
    exif: tiffMeta.exif,
    fileExif: tiffMeta.fileExif,
    digitizedAt: tiffMeta.digitizedAt,
    location: tiffMeta.location,
    world,
    creatorTool,
    dimensions: found.dimensions,
  };
};

/**
 * The metadata in a file, from its first bytes (`head`: at least up to the
 * image data; the whole file in the uploader) and, for a PNG whose head
 * does not reach its end, its last bytes (`tail`), where some writers put
 * their text chunks. Compressed XMP is inflated with DecompressionStream.
 */
export const readPhotoMeta = async (
  head: Uint8Array,
  tail?: Uint8Array,
): Promise<PhotoMeta> => {
  const found = find(head, tail);
  const xmp = [...found.xmp];
  for (const z of found.compressedXmp) {
    const text = await inflateCapped(z, MAX_XMP_BYTES);
    if (text !== null) xmp.push(text);
  }
  return decode(head, found, xmp);
};

/** Largest XMP packet inflated (real ones are a few KB). */
export const MAX_XMP_BYTES = 1024 * 1024;

/**
 * zlib data as UTF-8 text, or null when it is not valid zlib or inflates
 * past `max` bytes (a crafted chunk must not take all the memory).
 */
const inflateCapped = async (
  z: Uint8Array,
  max: number,
): Promise<string | null> => {
  const reader = new Blob([new Uint8Array(z)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) return null;
      parts.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return utf8(all);
};

/** readPhotoMeta without compressed XMP (synchronous). */
export const readPhotoMetaSync = (head: Uint8Array): PhotoMeta => {
  const found = find(head);
  return decode(head, found, found.xmp);
};

/** What is stored from a file (takenAt goes to media.timestamp apart). */
export type StoredMeta = Omit<
  PhotoMeta,
  "takenAt" | "dates" | "creatorTool" | "dimensions"
>;

/**
 * What the upload rules (upload-rules.ts) look at besides the stored
 * metadata; not stored.
 */
export type FileHints = Pick<PhotoMeta, "creatorTool" | "dimensions">;

const MAX_DIMENSION = 1 << 20;

/** Hints from a request, malformed parts left out. */
export const normalizeHints = (v: unknown): FileHints => {
  if (typeof v !== "object" || v === null) {
    return { creatorTool: null, dimensions: null };
  }
  const o = v as Record<string, unknown>;
  const d = o.dimensions as Record<string, unknown> | null | undefined;
  const dim = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_DIMENSION;
  return {
    creatorTool: text(o.creatorTool),
    dimensions:
      d && typeof d === "object" && dim(d.width) && dim(d.height)
        ? { width: d.width as number, height: d.height as number }
        : null,
  };
};

export const EMPTY_STORED: StoredMeta = {
  exif: null,
  fileExif: null,
  digitizedAt: null,
  location: null,
  world: null,
};

const EXIF_TYPES = {
  make: "string",
  model: "string",
  lens: "string",
  focal_length_mm: "number",
  f_number: "number",
  exposure_time: "string",
  iso: "number",
  orientation: "number",
  taken_at_original: "string",
} as const satisfies Record<keyof ExifJSON, "string" | "number">;

export const EXIF_KEYS = Object.keys(EXIF_TYPES) as (keyof ExifJSON)[];

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== ""
    ? cut(v.trim(), MAX_META_TEXT)
    : null;

/**
 * An exif object from a request (or the parser): only the known keys,
 * each of its type (finite positive numbers; non-empty strings, trimmed
 * and cut to MAX_META_TEXT). Null when nothing is left.
 */
export const normalizeExif = (v: unknown): ExifJSON | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string | number> = {};
  for (const key of EXIF_KEYS) {
    const value = (v as Record<string, unknown>)[key];
    if (EXIF_TYPES[key] === "number") {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out[key] = value;
      }
    } else {
      const s = text(value);
      if (s !== null) out[key] = s;
    }
  }
  if (
    out.orientation !== undefined &&
    !(Number.isInteger(out.orientation) && Number(out.orientation) <= 8)
  ) {
    delete out.orientation;
  }
  return Object.keys(out).length > 0 ? (out as ExifJSON) : null;
};

/** A position from a request: both coordinates in range, else null. */
export const normalizeLocation = (v: unknown): StoredMeta["location"] => {
  if (typeof v !== "object" || v === null) return null;
  const { latitude, longitude } = v as Record<string, unknown>;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !(Math.abs(latitude) <= 90) ||
    !(Math.abs(longitude) <= 180)
  ) {
    return null;
  }
  return { latitude, longitude };
};

/** A world from a request: ids of VRChat's shape, else left out. */
export const normalizeWorld = (v: unknown): WorldMeta | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && WORLD_ID_RE.test(o.id) ? o.id : null;
  const authorId =
    typeof o.authorId === "string" && USER_ID_RE.test(o.authorId)
      ? o.authorId
      : null;
  const name = text(o.name);
  return id || name ? { id, name, authorId } : null;
};

/** A file's own EXIF from a request: normalizeExif plus its extras. */
export const normalizeFileExif = (v: unknown): FileExifJSON | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: FileExifJSON = { ...(normalizeExif(v) ?? {}) };
  const software = text(o.software);
  if (software) out.software = software;
  if (typeof o.date_time === "string" && ISO_RE.test(o.date_time)) {
    out.date_time = o.date_time;
  }
  return Object.keys(out).length > 0 ? out : null;
};

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

/** The metadata of an upload request, every part optional. */
export const normalizeStoredMeta = (v: unknown): StoredMeta => {
  if (typeof v !== "object" || v === null) return EMPTY_STORED;
  const o = v as Record<string, unknown>;
  const fileExif = normalizeFileExif(o.fileExif);
  const digitized = isScanner(fileExif?.make, fileExif?.model);
  return {
    // A scanner's EXIF is never the shooting information, whatever a
    // client says.
    exif: digitized ? null : normalizeExif(o.exif),
    fileExif,
    digitizedAt:
      digitized &&
      typeof o.digitizedAt === "string" &&
      ISO_RE.test(o.digitizedAt)
        ? o.digitizedAt
        : null,
    location: normalizeLocation(o.location),
    world: normalizeWorld(o.world),
  };
};

/** Whether anything was found. */
export const hasMeta = (m: StoredMeta) =>
  m.exif !== null ||
  m.fileExif !== null ||
  m.location !== null ||
  m.world !== null;
