// When a photo was taken, read in the browser before uploading (covered
// by taken-at.spec.ts). Two sources, no dependencies:
//
// - VRChat's file names (VRChat_2026-11-18_01-02-03.456_3840x2160.png),
//   which are in the PC's local time: JST here.
// - EXIF DateTimeOriginal (falling back to DateTime) from a JPEG's APP1
//   segment or a PNG's eXIf chunk, with OffsetTimeOriginal when present
//   and JST otherwise (the cameras in use are set to Japan time). The
//   EXIF itself is read by photo-meta.ts.
//
// The result is an ISO 8601 date-time with an explicit offset, e.g.
// "2026-11-18T01:02:03.456+09:00" (formatJst and the public site read it).

import { DEFAULT_OFFSET, isoDateTime, readPhotoMetaSync } from "./photo-meta";
import { VRCHAT_NAME_RE } from "./upload";

export { DEFAULT_OFFSET, exifDateToIso } from "./photo-meta";

/** Taken-at time from a VRChat screenshot's file name, else null. */
export const vrchatTakenAt = (fileName: string): string | null => {
  const m = VRCHAT_NAME_RE.exec(fileName);
  if (!m) return null;
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  return isoDateTime(y, mo, d, h, mi, s, ms, DEFAULT_OFFSET);
};

/** Taken-at time from the first bytes of a JPEG or PNG, else null. */
export const exifTakenAt = (bytes: ArrayBuffer): string | null =>
  readPhotoMetaSync(new Uint8Array(bytes)).takenAt;
