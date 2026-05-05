import type { MediaPatch } from "./types";

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
    // Trim before normalising so callers don't have to remember to. An empty
    // (or whitespace-only) string collapses to null; a non-empty value is
    // stored trimmed.
    const normMake =
      typeof make === "string"
        ? make.trim() === ""
          ? null
          : make.trim()
        : make;
    const normModel =
      typeof model === "string"
        ? model.trim() === ""
          ? null
          : model.trim()
        : model;
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
    patch.tags = v
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  return { ok: true, patch };
};

export const parseTagsInput = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
