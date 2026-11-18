// Changing the public metadata levels of several photos at once (the Files
// view's selection; pure, bulk-metadata.spec.ts). A change names only the
// fields it sets: a level, or "" for the site's default (the photo's own
// override removed). Fields it leaves out keep each photo's own value.

import {
  isLevel,
  METADATA_FIELDS,
  type MetadataField,
  type MetadataOverrides,
} from "./metadata";

/** Field → level, or "" (follow the site's default). */
export type LevelChange = Partial<Record<MetadataField, string>>;

/**
 * What the selected photos share per field: their level, "" when all
 * follow the site's default, or null when they differ.
 */
export const commonLevels = (
  photos: readonly MetadataOverrides[],
): Record<MetadataField, string | null> => {
  const out = {} as Record<MetadataField, string | null>;
  for (const f of METADATA_FIELDS) {
    const values = new Set(photos.map((p) => p[f] ?? ""));
    out[f] = values.size === 1 ? [...values][0] : null;
  }
  return out;
};

/** A photo's overrides with `change` applied. */
export const withLevels = (
  current: MetadataOverrides,
  change: LevelChange,
): MetadataOverrides => {
  const out: Record<string, string> = { ...current };
  for (const [f, level] of Object.entries(change)) {
    if (level === "") delete out[f];
    else if (level !== undefined) out[f] = level;
  }
  return out as MetadataOverrides;
};

/** How overrides are stored (media.metadata_visibility): none is NULL. */
export const storedOverrides = (o: MetadataOverrides): string | null => {
  // Fixed field order, so equal overrides are stored alike.
  const sorted = Object.fromEntries(
    METADATA_FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]),
  );
  return Object.keys(sorted).length > 0 ? JSON.stringify(sorted) : null;
};

/** A change from a request: known fields, each "" or one of its levels. */
export const validateLevelChange = (
  v: unknown,
): { ok: true; value: LevelChange } | { ok: false; error: string } => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "levels must be an object" };
  }
  const out: LevelChange = {};
  for (const [k, level] of Object.entries(v)) {
    if (!(METADATA_FIELDS as string[]).includes(k)) {
      return { ok: false, error: `unknown field ${k}` };
    }
    const f = k as MetadataField;
    if (level !== "" && !isLevel(f, level)) {
      return { ok: false, error: `invalid level for ${k}` };
    }
    out[f] = level as string;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: "nothing to change" };
  }
  return { ok: true, value: out };
};
