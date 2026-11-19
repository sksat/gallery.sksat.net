// When a photo was taken, read in the browser before uploading and by the
// backfill (covered by taken-at.spec.ts). The sources, most trusted first:
//
// 1. EXIF DateTimeOriginal, with OffsetTimeOriginal when present and JST
//    otherwise (the cameras in use are set to Japan time);
// 2. the XMP date (xmp:CreateDate, which VRChat writes with its real
//    offset and sub-second time; else the EXIF / TIFF dates in XMP);
// 3. VRChat's file name (VRChat_2026-11-18_01-02-03.456_3840x2160.png),
//    in the PC's local time: JST here;
// 4. EXIF DateTime (when the file was last written).
//
// A film scanner's EXIF / XMP dates are the scan's and are never used
// (photo-meta.ts isScanner). The file's own dates are read by
// photo-meta.ts. The result is an ISO 8601 date-time with an explicit
// offset, to the millisecond, e.g. "2026-11-18T01:02:03.456+09:00".

import {
  DEFAULT_OFFSET,
  isoDateTime,
  readPhotoMetaSync,
  type FileDates,
} from "./photo-meta";
import type { TakenAtSource } from "./metadata-source";
import { VRCHAT_NAME_RE } from "./upload-rules";

export { DEFAULT_OFFSET, exifDateToIso } from "./photo-meta";

/** Taken-at time from a VRChat screenshot's file name, else null. */
export const vrchatTakenAt = (fileName: string): string | null => {
  const m = VRCHAT_NAME_RE.exec(fileName);
  if (!m) return null;
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  return isoDateTime(y, mo, d, h, mi, s, ms, DEFAULT_OFFSET);
};

/**
 * The taken-at time of a file named `fileName` (a bare name or a path)
 * with these dates, in the order above, and which source it came from
 * (media.metadata_source, metadata-source.ts). Null if unknown.
 */
export const pickTakenAt = (
  dates: FileDates,
  fileName: string,
): { at: string; source: Exclude<TakenAtSource, "manual"> } | null => {
  const name = vrchatTakenAt(fileName.slice(fileName.lastIndexOf("/") + 1));
  const candidates: [string | null, Exclude<TakenAtSource, "manual">][] = [
    [dates.exifOriginal, "exif"],
    [dates.xmp, "xmp"],
    [name, "filename"],
    [dates.exifDateTime, "file_date"],
  ];
  const hit = candidates.find(([at]) => at !== null);
  return hit ? { at: hit[0]!, source: hit[1] } : null;
};

/** Taken-at time from the first bytes of a JPEG or PNG, else null. */
export const exifTakenAt = (bytes: ArrayBuffer): string | null =>
  readPhotoMetaSync(new Uint8Array(bytes)).takenAt;
