// The device a file's EXIF names, and its camera row (covered by
// device.spec.ts and device-db.spec.ts on the real schema).
//
// A scanner's file (isScanner) names the device the photo was digitised
// with: it goes to media.digitized_with (スキャン機材). Any other file's
// Make / Model is the camera it was shot with: media.camera_id. Either is
// linked to the camera row with the same manufacturer and model (case
// aside), and when there is none, one is created (kind 'scanner', 'phone'
// or 'digital'), so a photo needs no click to get its device. Only while
// the photo has none and it was not chosen (or cleared) by hand
// (metadata_source.camera / digitized_with 'manual'). A VRChat photo is
// only linked, never given a new row (its camera is a virtual one,
// registered by hand).

import { type ExifJSON, type FileExifJSON, isScanner } from "./photo-meta";
import type { MediaPlatform } from "./types";

export type CameraKind = "digital" | "phone" | "scanner";

/** Which media column a device fills. */
export type DeviceRole = "camera" | "digitizer";

export type Device = {
  role: DeviceRole;
  /** As the file says (trimmed). */
  rawMake: string;
  rawModel: string;
  /** As a camera row stores it (normalizeDevice). */
  make: string;
  model: string;
  kind: CameraKind;
  /** Whether a missing camera row may be created. */
  create: boolean;
};

// Company words at the end of an EXIF Make ("NIKON CORPORATION",
// "RICOH IMAGING COMPANY, LTD.", "OLYMPUS IMAGING CORP.").
const SUFFIX =
  /[\s,]+(?:co\.?|ltd\.?|inc\.?|corp\.?|corporation|company|imaging|limited|gmbh|ag|s\.?a\.?|llc)$/i;

/**
 * The manufacturer and model a camera row stores for an EXIF Make / Model:
 * trimmed, the make without company words, and the model without the
 * make in front ("Canon" / "Canon EOS R5" → "Canon" / "EOS R5"; "RICOH
 * IMAGING COMPANY, LTD." / "RICOH GR III" → "RICOH" / "GR III").
 */
export const normalizeDevice = (
  make: string,
  model: string,
): { make: string; model: string } => {
  let mk = make.trim().replace(/\s+/g, " ");
  for (let prev = ""; prev !== mk;) {
    prev = mk;
    const cut = mk.replace(SUFFIX, "").replace(/[\s,]+$/, "");
    if (cut !== "") mk = cut;
  }
  let md = model.trim().replace(/\s+/g, " ");
  const lower = md.toLowerCase();
  const prefix = mk.toLowerCase();
  if (lower.startsWith(`${prefix} `) && md.length > prefix.length + 1) {
    md = md.slice(prefix.length + 1).trim();
  }
  return { make: mk, model: md };
};

const PHONE_MAKERS =
  /^(apple|google|xiaomi|redmi|poco|oneplus|oppo|vivo|huawei|honor|realme|motorola|nothing|fairphone|hmd global|zte|asus)$/i;

/**
 * 'phone' for the phones that are reliably told by their EXIF (Apple,
 * Google Pixel, Galaxy, Xperia, the Chinese makers, ...), else 'digital'.
 */
export const cameraKind = (
  make: string,
  model: string,
): "phone" | "digital" => {
  const mk = make.trim();
  const md = model.trim();
  if (/^google$/i.test(mk)) return /pixel/i.test(md) ? "phone" : "digital";
  if (PHONE_MAKERS.test(mk)) return "phone";
  if (/^samsung/i.test(mk))
    return /^(SM-|galaxy)/i.test(md) ? "phone" : "digital";
  if (/^sony/i.test(mk)) {
    return /^(xperia|XQ-|SO-|SOG\d|SOV\d|[A-Z]\d{4})/i.test(md)
      ? "phone"
      : "digital";
  }
  if (/^sharp/i.test(mk)) return /aquos|^SH-/i.test(md) ? "phone" : "digital";
  return "digital";
};

/**
 * The device a reading names: the scanner of a scanner's file (from its
 * file EXIF), else the camera of the shooting EXIF. Null without both a
 * make and a model.
 */
export const deviceOf = (
  meta: {
    exif?: ExifJSON | null;
    fileExif?: FileExifJSON | null;
  },
  platform: MediaPlatform | string | null,
): Device | null => {
  const file = meta.fileExif;
  if (isScanner(file?.make, file?.model)) {
    const rawMake = file?.make?.trim();
    const rawModel = file?.model?.trim();
    if (!rawMake || !rawModel) return null;
    return {
      role: "digitizer",
      rawMake,
      rawModel,
      ...normalizeDevice(rawMake, rawModel),
      kind: "scanner",
      create: true,
    };
  }
  const rawMake = meta.exif?.make?.trim();
  const rawModel = meta.exif?.model?.trim();
  if (!rawMake || !rawModel) return null;
  // A scanner's name in the shooting EXIF (edited by hand): not a camera.
  if (isScanner(rawMake, rawModel)) return null;
  return {
    role: "camera",
    rawMake,
    rawModel,
    ...normalizeDevice(rawMake, rawModel),
    kind: cameraKind(rawMake, rawModel),
    create: platform !== "VRChat",
  };
};

/** A slug for a new camera from its model ("QSS-32" → "qss-32"). */
export const slugFromModel = (model: string): string => {
  const s = model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "camera" : s.slice(0, 60).replace(/-+$/, "");
};

/** The column a role fills, and its metadata_source key. */
const COLUMN = { camera: "camera_id", digitizer: "digitized_with" } as const;
const SOURCE_KEY = { camera: "camera", digitizer: "digitized_with" } as const;

/**
 * SQL: the id of the camera row naming a device (four parameters: the
 * file's make, the stored make, the file's model, the stored model),
 * either spelling, case aside, the first by id. The camera table is a few
 * dozen rows: read without an index.
 */
export const deviceIdSql = (
  rawMake: string,
  make: string,
  rawModel: string,
  model: string,
) =>
  `(SELECT c.id FROM camera c
    WHERE lower(c.manufacturer) IN (lower(${rawMake}), lower(${make}))
      AND lower(c.model) IN (lower(${rawModel}), lower(${model}))
    ORDER BY c.id LIMIT 1)`;

/** The parameters of deviceIdSql, in order. */
export const deviceIdArgs = (d: Device | null) => [
  d?.rawMake ?? null,
  d?.make ?? null,
  d?.rawModel ?? null,
  d?.model ?? null,
];

/** SQL: whether the media row may take a `role` device automatically. */
const mayLinkSql = (role: DeviceRole, alias = "") =>
  `${alias}${COLUMN[role]} IS NULL
   AND COALESCE(json_extract(${alias}metadata_source, '$.${SOURCE_KEY[role]}'), '') <> 'manual'`;

/**
 * An UPDATE's SET terms linking camera_id and digitized_with to the
 * device's row: ?role ('camera' / 'digitizer' / NULL for none) and the
 * four deviceIdSql parameters. Each only while the photo has none and it
 * was not chosen by hand; the lookup runs only for the column the device
 * fills.
 */
export const linkDeviceSql = (
  role: string,
  rawMake: string,
  make: string,
  rawModel: string,
  model: string,
) => {
  const id = deviceIdSql(rawMake, make, rawModel, model);
  return `camera_id = CASE WHEN ${role} = 'camera' AND ${mayLinkSql("camera")}
       THEN ${id} ELSE camera_id END,
     digitized_with = CASE WHEN ${role} = 'digitizer' AND ${mayLinkSql("digitizer")}
       THEN ${id} ELSE digitized_with END`;
};

/** How many numbered slugs ("x-2" … ) a new row may take. */
const SLUG_TRIES = 50;

/**
 * A statement creating the camera row for `device` when no row names it
 * yet: the model as its name, the first free slug of slugFromModel
 * ("scanner", "scanner-2", ...), no picture. With `forMedia`, only when
 * that photo would take it (its column empty, not chosen by hand). Run it
 * in the same D1 batch before the write that links the photo (deviceIdSql
 * then finds it). INSERT OR IGNORE and the NOT EXISTS make it safe to run
 * twice or from two requests at once: D1 runs a batch as one transaction,
 * and the slug is UNIQUE.
 */
export const ensureDeviceStatement = (
  db: D1Database,
  device: Device,
  forMedia?: number,
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT OR IGNORE INTO camera (slug, name, manufacturer, model, kind)
       SELECT s, ?4, ?2, ?4, ?6 FROM (
         WITH RECURSIVE n(i) AS (
           SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${SLUG_TRIES})
         SELECT CASE WHEN i = 1 THEN ?5 ELSE ?5 || '-' || i END AS s FROM n)
       WHERE NOT EXISTS (SELECT 1 FROM camera WHERE slug = s)
         AND ${deviceIdSql("?1", "?2", "?3", "?4")} IS NULL
         AND (?7 IS NULL OR EXISTS (
           SELECT 1 FROM media WHERE id = ?7 AND ${mayLinkSql(device.role)}))
       LIMIT 1`,
    )
    .bind(
      device.rawMake,
      device.make,
      device.rawModel,
      device.model,
      slugFromModel(device.model),
      device.kind,
      forMedia ?? null,
    );
