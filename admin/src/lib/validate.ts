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

  if ("camera_make" in obj) {
    const v = obj.camera_make;
    if (v !== null && typeof v !== "string") {
      return { ok: false, error: "camera_make must be string or null" };
    }
    patch.camera_make = v === "" ? null : v;
  }

  if ("camera_model" in obj) {
    const v = obj.camera_model;
    if (v !== null && typeof v !== "string") {
      return { ok: false, error: "camera_model must be string or null" };
    }
    patch.camera_model = v === "" ? null : v;
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
