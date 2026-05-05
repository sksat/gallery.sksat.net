import type { MediaPatch } from "./types";

// Mirror the per-field caps the form's zod$ schema enforces so a direct
// PATCH bypassing the form sees the same limits.
const MAX_CAMERA_FIELD_LEN = 200;
const MAX_TAG_LEN = 200;
const MAX_TAGS = 100;

export type ValidatePatchResult =
  | { ok: true; patch: MediaPatch }
  | { ok: false; error: string };

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

  // camera_make and camera_model are paired: exported JSON drops the camera
  // object entirely if either is null, so any patch must touch them as a pair
  // and end up with both set or both cleared.
  const hasMake = "camera_make" in obj;
  const hasModel = "camera_model" in obj;
  if (hasMake !== hasModel) {
    return {
      ok: false,
      error: "camera_make and camera_model must be patched together",
    };
  }
  if (hasMake && hasModel) {
    const make = obj.camera_make;
    const model = obj.camera_model;
    if (make !== null && typeof make !== "string") {
      return { ok: false, error: "camera_make must be string or null" };
    }
    if (model !== null && typeof model !== "string") {
      return { ok: false, error: "camera_model must be string or null" };
    }
    // Trim first so callers don't have to. An empty (or whitespace-only)
    // string collapses to null; a non-empty value is stored trimmed.
    // Length checks then run on the post-trim value so a value that fits
    // after normalisation isn't rejected for stray whitespace.
    const trimmedMake = typeof make === "string" ? make.trim() : make;
    const trimmedModel = typeof model === "string" ? model.trim() : model;
    if (
      typeof trimmedMake === "string" &&
      trimmedMake.length > MAX_CAMERA_FIELD_LEN
    ) {
      return {
        ok: false,
        error: `camera_make exceeds ${MAX_CAMERA_FIELD_LEN} chars`,
      };
    }
    if (
      typeof trimmedModel === "string" &&
      trimmedModel.length > MAX_CAMERA_FIELD_LEN
    ) {
      return {
        ok: false,
        error: `camera_model exceeds ${MAX_CAMERA_FIELD_LEN} chars`,
      };
    }
    // trimmedMake/trimmedModel are already narrowed to string|null by the
    // earlier typeof guard; just collapse "" to null.
    const normMake = trimmedMake === "" ? null : trimmedMake;
    const normModel = trimmedModel === "" ? null : trimmedModel;
    if ((normMake === null) !== (normModel === null)) {
      return {
        ok: false,
        error: "camera_make and camera_model must both be set or both be null",
      };
    }
    patch.camera_make = normMake;
    patch.camera_model = normModel;
  }

  if ("tags" in obj) {
    const v = obj.tags;
    if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) {
      return { ok: false, error: "tags must be an array of strings" };
    }
    // Trim + drop empties first so the length cap evaluates the
    // post-normalisation form.
    const trimmedTags = v.map((t) => t.trim()).filter((t) => t.length > 0);
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

export const parseTagsInput = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
