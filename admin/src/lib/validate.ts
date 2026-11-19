import {
  isTagFieldLevel,
  type TagFieldLevel,
  type TagFieldValue,
} from "@shared/tag-field/tag-field";
import { validateOverrides } from "./metadata";
import { isPlatformKey } from "./platform";
import {
  validateExifEdit,
  validateLocationEdit,
  validateWorldEdit,
} from "./photo-data";
import {
  CAMERA_KINDS,
  type CameraInput,
  type CameraKind,
  type MediaPatch,
  isVisibility,
  VISIBILITIES,
  type Visibility,
} from "./types";

// Mirror of the per-field caps the forms' zod$ schemas enforce so a direct
// API call bypassing the form sees the same limits.
const MAX_TAG_LEN = 200;
const MAX_TAGS = 100;
export const MAX_CAMERA_SLUG_LEN = 64;
export const MAX_CAMERA_FIELD_LEN = 200;
export const MAX_CAMERA_DESCRIPTION_LEN = 2000;
export const MAX_CAMERA_URL_LEN = 2000;

/** Lowercase ASCII words joined by single '-' (e.g. `virtuallens2`). */
export const CAMERA_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ValidatePatchResult =
  { ok: true; patch: MediaPatch } | { ok: false; error: string };

/** The fields a media PATCH may set. */
const PATCH_FIELDS = new Set([
  "platform",
  "metadata_visibility",
  "camera_id",
  "digitized_with",
  "embed_exif",
  "timestamp",
  "tags",
  "visibility",
  "exif",
  "location",
  "world_id",
  "world_name",
  "reset_from_file",
  "tag_values",
  "tag_value_visibility",
]);

const RESETTABLE = ["exif", "world", "location", "taken_at"] as const;

/**
 * A full date and time with its offset, as media.timestamp stores it
 * ("2024-03-08T00:00:00+09:00", milliseconds optional) and a real date.
 */
export const isIsoWithOffset = (v: string): boolean => {
  const m =
    /^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      v,
    );
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
};

export const validatePatch = (input: unknown): ValidatePatchResult => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = input as Record<string, unknown>;
  const patch: MediaPatch = {};

  // Only the fields below. Anything else is an error rather than ignored,
  // so a client sending `world` (now the VRChat world, not the platform)
  // or a typo learns that nothing was saved.
  for (const key of Object.keys(obj)) {
    if (!PATCH_FIELDS.has(key)) {
      return { ok: false, error: `unknown field: ${key}` };
    }
  }

  if ("platform" in obj) {
    const platform = obj.platform;
    // A platform key; whether it exists is for D1 (media.platform
    // REFERENCES platform, checked by the caller like camera_id).
    if (!isPlatformKey(platform)) {
      return { ok: false, error: "platform must be a platform key" };
    }
    patch.platform = platform;
  }

  if ("metadata_visibility" in obj) {
    const v = validateOverrides(obj.metadata_visibility);
    if (!v.ok) return v;
    patch.metadata_visibility = v.value;
  }

  // Whether the id exists is checked against D1 by the caller
  // (cameraExists), since this function stays pure.
  if ("camera_id" in obj) {
    const v = obj.camera_id;
    if (v !== null && !(Number.isInteger(v) && (v as number) > 0)) {
      return {
        ok: false,
        error: "camera_id must be a positive integer or null",
      };
    }
    patch.camera_id = v as number | null;
  }
  if ("digitized_with" in obj) {
    const v = obj.digitized_with;
    if (v !== null && !(Number.isInteger(v) && (v as number) > 0)) {
      return {
        ok: false,
        error: "digitized_with must be a positive integer or null",
      };
    }
    patch.digitized_with = v as number | null;
  }
  if ("embed_exif" in obj) {
    const v = obj.embed_exif;
    if (v !== null && typeof v !== "boolean") {
      return { ok: false, error: "embed_exif must be true, false or null" };
    }
    patch.embed_exif = v;
  }
  if ("timestamp" in obj) {
    const v = obj.timestamp;
    if (v !== null && !(typeof v === "string" && isIsoWithOffset(v))) {
      return {
        ok: false,
        error: "timestamp must be ISO 8601 with an offset, or null",
      };
    }
    patch.timestamp = v;
  }

  if ("tags" in obj) {
    const v = obj.tags;
    if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) {
      return { ok: false, error: "tags must be an array of strings" };
    }
    // Trim + drop empties + dedupe (preserve first-seen order) so the
    // length cap evaluates the post-normalisation form.
    const seen = new Set<string>();
    const trimmedTags: string[] = [];
    for (const raw of v) {
      const t = raw.trim();
      if (t.length === 0 || seen.has(t)) continue;
      seen.add(t);
      trimmedTags.push(t);
    }
    if (trimmedTags.length > MAX_TAGS) {
      return { ok: false, error: `tags exceeds ${MAX_TAGS} entries` };
    }
    if (trimmedTags.some((t) => t.length > MAX_TAG_LEN)) {
      return { ok: false, error: `tag exceeds ${MAX_TAG_LEN} chars` };
    }
    patch.tags = trimmedTags;
  }

  if ("visibility" in obj) {
    if (!isVisibility(obj.visibility)) {
      return {
        ok: false,
        error: `visibility must be one of ${VISIBILITIES.join(", ")}`,
      };
    }
    patch.visibility = obj.visibility;
  }

  if ("exif" in obj) {
    const v = validateExifEdit(obj.exif);
    if (!v.ok) return v;
    patch.exif = v.value;
  }
  if ("location" in obj) {
    const v = validateLocationEdit(obj.location);
    if (!v.ok) return v;
    patch.location = v.value;
  }
  // The VRChat world: world_id and/or world_name, each kept when left out.
  if ("world_id" in obj || "world_name" in obj) {
    const v = validateWorldEdit({ id: obj.world_id, name: obj.world_name });
    if (!v.ok) return v;
    patch.world = v.value;
  }

  if ("reset_from_file" in obj) {
    const v = obj.reset_from_file;
    if (
      !Array.isArray(v) ||
      !v.every((f) => (RESETTABLE as readonly unknown[]).includes(f))
    ) {
      return {
        ok: false,
        error: `reset_from_file must list some of ${RESETTABLE.join(", ")}`,
      };
    }
    const fields = [...new Set(v as (typeof RESETTABLE)[number][])];
    // Editing a field and setting it back in one go says two things.
    if (
      (fields.includes("exif") && patch.exif) ||
      (fields.includes("world") && patch.world) ||
      (fields.includes("location") && patch.location !== undefined) ||
      (fields.includes("taken_at") && patch.timestamp !== undefined)
    ) {
      return { ok: false, error: "a field cannot be edited and reset at once" };
    }
    if (fields.length > 0) patch.reset_from_file = fields;
  }

  // Shapes only: the values are checked against their fields in
  // db-tag-field.ts (resolveTagValuePatch), which needs D1.
  if ("tag_values" in obj) {
    const v = validateTagValueShape(obj.tag_values);
    if (!v.ok) return v;
    patch.tag_values = v.value;
  }
  if ("tag_value_visibility" in obj) {
    const v = validateTagLevelShape(obj.tag_value_visibility);
    if (!v.ok) return v;
    patch.tag_value_visibility = v.value;
  }

  return { ok: true, patch };
};

/** Most field ids one change may name. */
const MAX_TAG_FIELD_KEYS = 200;
const FIELD_ID_RE = /^[1-9]\d{0,15}$/;

const fieldMap = (
  v: unknown,
  name: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: `${name} must be an object` };
  }
  const entries = Object.entries(v);
  if (entries.length > MAX_TAG_FIELD_KEYS) {
    return { ok: false, error: `${name} has too many fields` };
  }
  if (entries.some(([k]) => !FIELD_ID_RE.test(k))) {
    return { ok: false, error: `${name} keys must be field ids` };
  }
  return { ok: true, value: v as Record<string, unknown> };
};

/** tag_values: field id → string, number or null (clear). */
export const validateTagValueShape = (
  v: unknown,
):
  | { ok: true; value: Record<string, TagFieldValue | null> }
  | { ok: false; error: string } => {
  const m = fieldMap(v, "tag_values");
  if (!m.ok) return m;
  for (const value of Object.values(m.value)) {
    if (
      value !== null &&
      !(typeof value === "string" && value.length <= 400) &&
      !(typeof value === "number" && Number.isFinite(value))
    ) {
      return { ok: false, error: "tag_values must be strings or numbers" };
    }
  }
  return {
    ok: true,
    value: m.value as Record<string, TagFieldValue | null>,
  };
};

/** tag_value_visibility: field id → shown / hidden, or null (default). */
export const validateTagLevelShape = (
  v: unknown,
):
  | { ok: true; value: Record<string, TagFieldLevel | null> }
  | { ok: false; error: string } => {
  const m = fieldMap(v, "tag_value_visibility");
  if (!m.ok) return m;
  for (const level of Object.values(m.value)) {
    if (level !== null && !isTagFieldLevel(level)) {
      return {
        ok: false,
        error: "tag_value_visibility must be shown, hidden or null",
      };
    }
  }
  return {
    ok: true,
    value: m.value as Record<string, TagFieldLevel | null>,
  };
};

export type ValidateRestoreResult =
  | { ok: true; groups: { visibility: Visibility; ids: number[] }[] }
  | { ok: false; error: string };

/**
 * Undo of a bulk change: each photo's previous visibility, grouped so the
 * restore is one setVisibility per visibility. The first entry for an id
 * wins; at most `maxIds` distinct ids.
 */
export const validateRestoreVisibility = (
  changes: unknown,
  maxIds: number,
): ValidateRestoreResult => {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, error: "nothing to restore" };
  }
  const seen = new Set<number>();
  const byVisibility = new Map<Visibility, number[]>();
  for (const c of changes) {
    const { id, visibility } = (c ?? {}) as Record<string, unknown>;
    if (!Number.isSafeInteger(id) || (id as number) <= 0) {
      return { ok: false, error: "ids must be positive integers" };
    }
    if (!isVisibility(visibility)) {
      return {
        ok: false,
        error: `visibility must be one of ${VISIBILITIES.join(", ")}`,
      };
    }
    if (seen.has(id as number)) continue;
    seen.add(id as number);
    const ids = byVisibility.get(visibility) ?? [];
    ids.push(id as number);
    byVisibility.set(visibility, ids);
  }
  if (seen.size > maxIds) {
    return { ok: false, error: `at most ${maxIds} photos at a time` };
  }
  return {
    ok: true,
    groups: VISIBILITIES.filter((v) => byVisibility.has(v)).map((v) => ({
      visibility: v,
      ids: byVisibility.get(v)!,
    })),
  };
};

export type ValidateBulkResult =
  | { ok: true; ids: number[]; visibility: Visibility }
  | { ok: false; error: string };

/**
 * A bulk visibility change: `ids` (positive integers, deduplicated, at
 * most `maxIds`) and the new `visibility`.
 */
export const validateBulkVisibility = (
  input: { ids: unknown; visibility: unknown },
  maxIds: number,
): ValidateBulkResult => {
  if (!isVisibility(input.visibility)) {
    return {
      ok: false,
      error: `visibility must be one of ${VISIBILITIES.join(", ")}`,
    };
  }
  const raw = Array.isArray(input.ids) ? input.ids : [input.ids];
  const ids: number[] = [];
  for (const v of raw) {
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
    if (!Number.isSafeInteger(n) || (n as number) <= 0) {
      return { ok: false, error: "ids must be positive integers" };
    }
    if (!ids.includes(n as number)) ids.push(n as number);
  }
  if (ids.length === 0)
    return { ok: false, error: "select at least one photo" };
  if (ids.length > maxIds) {
    return { ok: false, error: `at most ${maxIds} photos at a time` };
  }
  return { ok: true, ids, visibility: input.visibility };
};

/**
 * The camera <select> value: "" means no camera, anything else must be a
 * positive integer id. Returns undefined for garbage so the caller can
 * reject it (validatePatch then reports the error).
 */
export const parseCameraIdInput = (raw: string): number | null | undefined => {
  if (raw === "") return null;
  if (!/^[1-9][0-9]*$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
};

export type ValidateCameraResult =
  { ok: true; camera: CameraInput } | { ok: false; error: string };

type OptionalText =
  { ok: true; value: string | null } | { ok: false; error: string };

// Trim; "" (or absent / null) becomes null; then cap the length.
const optionalText = (
  obj: Record<string, unknown>,
  key: string,
  max: number,
): OptionalText => {
  const v = obj[key];
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") {
    return { ok: false, error: `${key} must be a string or null` };
  }
  const t = v.trim();
  if (t.length > max) {
    return { ok: false, error: `${key} exceeds ${max} chars` };
  }
  return { ok: true, value: t === "" ? null : t };
};

const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** Full camera record for create and edit (both send every field). */
export const validateCamera = (input: unknown): ValidateCameraResult => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.slug !== "string") {
    return { ok: false, error: "slug is required" };
  }
  const slug = obj.slug.trim();
  if (slug.length > MAX_CAMERA_SLUG_LEN) {
    return {
      ok: false,
      error: `slug exceeds ${MAX_CAMERA_SLUG_LEN} chars`,
    };
  }
  if (!CAMERA_SLUG_RE.test(slug)) {
    return {
      ok: false,
      error:
        "slug must be lowercase letters, digits and single hyphens (e.g. virtuallens2)",
    };
  }

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    return { ok: false, error: "name is required" };
  }
  const name = obj.name.trim();
  if (name.length > MAX_CAMERA_FIELD_LEN) {
    return {
      ok: false,
      error: `name exceeds ${MAX_CAMERA_FIELD_LEN} chars`,
    };
  }

  const manufacturer = optionalText(obj, "manufacturer", MAX_CAMERA_FIELD_LEN);
  if (!manufacturer.ok) return manufacturer;
  const model = optionalText(obj, "model", MAX_CAMERA_FIELD_LEN);
  if (!model.ok) return model;
  const description = optionalText(
    obj,
    "description",
    MAX_CAMERA_DESCRIPTION_LEN,
  );
  if (!description.ok) return description;
  // Both URLs are rendered as links on the public site: only http(s),
  // never javascript: or data:.
  const productUrl = optionalText(obj, "product_url", MAX_CAMERA_URL_LEN);
  if (!productUrl.ok) return productUrl;
  if (productUrl.value !== null && !isHttpUrl(productUrl.value)) {
    return { ok: false, error: "product_url must be an http(s) URL" };
  }
  const manufacturerUrl = optionalText(
    obj,
    "manufacturer_url",
    MAX_CAMERA_URL_LEN,
  );
  if (!manufacturerUrl.ok) return manufacturerUrl;
  if (manufacturerUrl.value !== null && !isHttpUrl(manufacturerUrl.value)) {
    return { ok: false, error: "manufacturer_url must be an http(s) URL" };
  }

  let kind: CameraKind | null = null;
  if (obj.kind !== undefined && obj.kind !== null && obj.kind !== "") {
    if (!(CAMERA_KINDS as readonly unknown[]).includes(obj.kind)) {
      return {
        ok: false,
        error: `kind must be one of ${CAMERA_KINDS.join(", ")}`,
      };
    }
    kind = obj.kind as CameraKind;
  }

  return {
    ok: true,
    camera: {
      slug,
      name,
      manufacturer: manufacturer.value,
      manufacturer_url: manufacturerUrl.value,
      model: model.value,
      kind,
      description: description.value,
      product_url: productUrl.value,
    },
  };
};

export const MAX_IMAGE_FILE_LEN = 500;
export const MAX_IMAGE_CAPTION_LEN = 200;

const IMAGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const IMAGE_EXT_RE = /\.(png|jpe?g)$/i;

/** Folder a camera's pictures go in by convention. */
export const cameraImageDir = (slug: string): string => `/camera/${slug}/`;

/**
 * The image path typed on the camera page: a bare file name ("front.png")
 * is in the camera's folder; anything starting with "/" is used as is.
 * Validated afterwards by validateImageFile.
 */
export const resolveCameraImagePath = (input: string, slug: string): string => {
  const s = input.trim();
  return s === "" || s.startsWith("/") ? s : cameraImageDir(slug) + s;
};

/**
 * The length error for an image path typed on the camera page, measured
 * after a bare file name gets its `/camera/<slug>/` prefix; null when it
 * fits. Checked in the browser before submitting, and by the action.
 */
export const cameraImagePathLengthError = (
  input: string,
  slug: string,
): string | null => {
  const s = input.trim();
  const resolved = resolveCameraImagePath(s, slug);
  if (resolved.length <= MAX_IMAGE_FILE_LEN) return null;
  return s.startsWith("/")
    ? `The path is ${resolved.length} characters; at most ${MAX_IMAGE_FILE_LEN}.`
    : `With ${cameraImageDir(slug)} in front, the path is ${resolved.length} characters; at most ${MAX_IMAGE_FILE_LEN}.`;
};

/**
 * A bucket path for an image, in the same shape as media.file
 * (`/camera/virtuallens2/front.png`): leading "/", segments of
 * `[A-Za-z0-9._-]` only, no "." / ".." segments, png/jpg/jpeg. It is
 * appended to the image Worker / bucket URLs as-is, so nothing that could
 * change the URL's meaning (`?`, `#`, `%`, `\`, `..`) gets through.
 */
export const validateImageFile = (
  input: unknown,
): { ok: true; file: string } | { ok: false; error: string } => {
  if (typeof input !== "string") {
    return { ok: false, error: "file is required" };
  }
  const file = input.trim();
  if (file.length > MAX_IMAGE_FILE_LEN) {
    return { ok: false, error: `file exceeds ${MAX_IMAGE_FILE_LEN} chars` };
  }
  const segments = file.split("/");
  if (
    !file.startsWith("/") ||
    segments
      .slice(1)
      .some((s) => !IMAGE_SEGMENT_RE.test(s) || s === "." || s === "..")
  ) {
    return {
      ok: false,
      error:
        'file must be a path like /camera/<slug>/front.png (leading "/", letters, digits, ".", "_", "-")',
    };
  }
  if (!IMAGE_EXT_RE.test(file)) {
    return { ok: false, error: "file must be a .png, .jpg or .jpeg image" };
  }
  return { ok: true, file };
};

export type ValidateCameraImageResult =
  | { ok: true; image: { file: string; caption: string | null } }
  | { ok: false; error: string };

export const validateCameraImage = (
  input: unknown,
): ValidateCameraImageResult => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = input as Record<string, unknown>;
  const file = validateImageFile(obj.file);
  if (!file.ok) return file;
  const caption = optionalText(obj, "caption", MAX_IMAGE_CAPTION_LEN);
  if (!caption.ok) return caption;
  return { ok: true, image: { file: file.file, caption: caption.value } };
};

export const parseTagsInput = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
