import {
  CAMERA_KINDS,
  type CameraInput,
  type CameraKind,
  type MediaPatch,
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

export const validatePatch = (input: unknown): ValidatePatchResult => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = input as Record<string, unknown>;
  const patch: MediaPatch = {};

  if ("world" in obj) {
    if (obj.world !== "Real" && obj.world !== "VRChat") {
      return { ok: false, error: "world must be 'Real' or 'VRChat'" };
    }
    patch.world = obj.world;
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

  return { ok: true, patch };
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

  const make = optionalText(obj, "make", MAX_CAMERA_FIELD_LEN);
  if (!make.ok) return make;
  const model = optionalText(obj, "model", MAX_CAMERA_FIELD_LEN);
  if (!model.ok) return model;
  const description = optionalText(
    obj,
    "description",
    MAX_CAMERA_DESCRIPTION_LEN,
  );
  if (!description.ok) return description;
  const productUrl = optionalText(obj, "product_url", MAX_CAMERA_URL_LEN);
  if (!productUrl.ok) return productUrl;
  // Rendered as a link on the public site: only http(s), never
  // javascript: or data:.
  if (productUrl.value !== null && !isHttpUrl(productUrl.value)) {
    return { ok: false, error: "product_url must be an http(s) URL" };
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
      make: make.value,
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

/**
 * A bucket path for an image, in the same shape as media.file
 * (`/cameras/virtuallens2.png`): leading "/", segments of
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
        'file must be a path like /cameras/name.png (leading "/", letters, digits, ".", "_", "-")',
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
