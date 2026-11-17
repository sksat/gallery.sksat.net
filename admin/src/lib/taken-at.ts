// When a photo was taken, read in the browser before uploading (covered
// by taken-at.spec.ts). Two sources, no dependencies:
//
// - VRChat's file names (VRChat_2026-11-18_01-02-03.456_3840x2160.png),
//   which are in the PC's local time: JST here.
// - EXIF DateTimeOriginal (falling back to DateTime) from a JPEG's APP1
//   segment or a PNG's eXIf chunk, with OffsetTimeOriginal when present
//   and JST otherwise (the cameras in use are set to Japan time).
//
// The result is an ISO 8601 date-time with an explicit offset, e.g.
// "2026-11-18T01:02:03.456+09:00" (formatJst and the public site read it).

import { VRCHAT_NAME_RE } from "./upload";

/** Offset assumed when a source has none. */
export const DEFAULT_OFFSET = "+09:00";

/** How much of a file to read for EXIF (it sits at the start). */
export const EXIF_SCAN_BYTES = 256 * 1024;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO string from parts, or null if they are not a real date-time. */
const iso = (
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

/** Taken-at time from a VRChat screenshot's file name, else null. */
export const vrchatTakenAt = (fileName: string): string | null => {
  const m = VRCHAT_NAME_RE.exec(fileName);
  if (!m) return null;
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  return iso(y, mo, d, h, mi, s, ms, DEFAULT_OFFSET);
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
  return iso(y, mo, d, h, mi, s, null, off);
};

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
/** The only text values read. */
const ASCII_TAGS = new Set([
  TAG_DATETIME,
  TAG_DATETIME_ORIGINAL,
  TAG_OFFSET_TIME_ORIGINAL,
]);
const MAX_IFD_ENTRIES = 512;
const MAX_ASCII = 32;

/** ASCII / LONG values of one IFD, by tag. Throws on out-of-range reads. */
const readIfd = (
  view: DataView,
  tiff: number,
  offset: number,
  little: boolean,
): Map<number, string | number> => {
  const out = new Map<number, string | number>();
  const at = tiff + offset;
  // Bounded work on a crafted file: real IFDs have a few dozen entries.
  const count = Math.min(view.getUint16(at, little), MAX_IFD_ENTRIES);
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    const tag = view.getUint16(e, little);
    const type = view.getUint16(e + 2, little);
    const n = view.getUint32(e + 4, little);
    if (type === 2 && ASCII_TAGS.has(tag)) {
      // ASCII: inline when it fits in 4 bytes. Dates are 20 bytes.
      const start = n <= 4 ? e + 8 : tiff + view.getUint32(e + 8, little);
      let s = "";
      for (let j = 0; j < Math.min(n, MAX_ASCII); j++) {
        const c = view.getUint8(start + j);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      out.set(tag, s);
    } else if (type === 4 && n === 1) {
      out.set(tag, view.getUint32(e + 8, little));
    }
  }
  return out;
};

/** Taken-at time from a TIFF/EXIF block starting at `tiff`, else null. */
const fromTiff = (view: DataView, tiff: number): string | null => {
  const order = view.getUint16(tiff, false);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return null;
  const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
  const exifAt = ifd0.get(TAG_EXIF_IFD);
  if (typeof exifAt === "number") {
    const exif = readIfd(view, tiff, exifAt, little);
    const original = exif.get(TAG_DATETIME_ORIGINAL);
    const offset = exif.get(TAG_OFFSET_TIME_ORIGINAL);
    if (typeof original === "string") {
      const v = exifDateToIso(
        original,
        typeof offset === "string" ? offset : null,
      );
      if (v) return v;
    }
  }
  const dt = ifd0.get(TAG_DATETIME);
  return typeof dt === "string" ? exifDateToIso(dt, null) : null;
};

/** Start of the TIFF block in a JPEG (APP1 "Exif\0\0"), or -1. */
const jpegTiff = (view: DataView): number => {
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) return -1;
    const marker = view.getUint8(p + 1);
    // Start of scan / end of image: no metadata after this.
    if (marker === 0xda || marker === 0xd9) return -1;
    const len = view.getUint16(p + 2, false);
    if (
      marker === 0xe1 &&
      p + 10 <= view.byteLength &&
      view.getUint32(p + 4, false) === 0x45786966 && // "Exif"
      view.getUint16(p + 8, false) === 0
    ) {
      return p + 10;
    }
    p += 2 + len;
  }
  return -1;
};

/** Start of a PNG's eXIf chunk data, or -1. */
const pngTiff = (view: DataView): number => {
  let p = 8;
  while (p + 8 <= view.byteLength) {
    const len = view.getUint32(p, false);
    const type = view.getUint32(p + 4, false);
    if (type === 0x65584966) return p + 8; // "eXIf"
    if (type === 0x49444154 || type === 0x49454e44) return -1; // IDAT, IEND
    p += 12 + len;
  }
  return -1;
};

/** Taken-at time from the first bytes of a JPEG or PNG, else null. */
export const exifTakenAt = (bytes: ArrayBuffer): string | null => {
  const view = new DataView(bytes);
  try {
    let tiff = -1;
    if (view.byteLength >= 4 && view.getUint16(0, false) === 0xffd8) {
      tiff = jpegTiff(view);
    } else if (
      view.byteLength >= 8 &&
      view.getUint32(0, false) === 0x89504e47 &&
      view.getUint32(4, false) === 0x0d0a1a0a
    ) {
      tiff = pngTiff(view);
    }
    return tiff < 0 ? null : fromTiff(view, tiff);
  } catch {
    // Truncated or malformed metadata (a read past the end): no date.
    return null;
  }
};

/**
 * Taken-at time of a picked file: the VRChat name first (exact to the
 * millisecond), then EXIF from its first EXIF_SCAN_BYTES. Null if unknown.
 */
export const takenAt = async (file: {
  name: string;
  slice: (
    start: number,
    end: number,
  ) => { arrayBuffer(): Promise<ArrayBuffer> };
}): Promise<string | null> =>
  vrchatTakenAt(file.name) ??
  exifTakenAt(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
