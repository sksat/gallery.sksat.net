// The edit page's tag field inputs (components/tag-field-inputs.tsx) as
// form values, and the change they make (pure; tag-field-form.spec.ts).
// Inputs are named `tf.f<id>` (value) and `tfv.f<id>` (level; "" = the
// field's default): Qwik City turns the dotted names into objects, and the
// "f" keeps the keys from being read as array indexes.

import {
  formatValue,
  isTagFieldLevel,
  readValue,
  type TagFieldDef,
  type TagFieldLevel,
} from "@shared/tag-field/tag-field";
import type { MediaRow } from "./types";

export type TagFieldForm = {
  values: Record<string, string>;
  levels: Record<string, string>;
};

/** What the inputs start with, keyed f<id>. */
export const tagFieldFormValues = (
  row: Pick<MediaRow, "tag_values" | "tag_value_visibility">,
  fields: readonly TagFieldDef[],
): TagFieldForm => {
  const values: Record<string, string> = {};
  const levels: Record<string, string> = {};
  for (const f of fields) {
    const v = readValue(f.type, row.tag_values[String(f.id)]);
    values[`f${f.id}`] = v === null ? "" : formatValue(v);
    levels[`f${f.id}`] = row.tag_value_visibility[String(f.id)] ?? "";
  }
  return { values, levels };
};

const KEY_RE = /^f([1-9]\d{0,15})$/;

/**
 * The change of a submitted form: only the inputs whose value differs
 * from what the page loaded them with (so a page opened before another
 * edit does not undo it). Values go as typed ("" clears; the server
 * checks them against the fields); levels "" go back to the default.
 * Malformed loaded state changes nothing.
 */
export const tagFieldPatch = (
  loadedRaw: string | undefined,
  tf: Record<string, string> | undefined,
  tfv: Record<string, string> | undefined,
): {
  tag_values?: Record<string, string | null>;
  tag_value_visibility?: Record<string, TagFieldLevel | null>;
} => {
  if (loadedRaw === undefined) return {};
  let loaded: TagFieldForm;
  try {
    loaded = JSON.parse(loadedRaw) as TagFieldForm;
    if (
      typeof loaded !== "object" ||
      loaded === null ||
      typeof loaded.values !== "object" ||
      typeof loaded.levels !== "object"
    ) {
      return {};
    }
  } catch {
    return {};
  }
  const values: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(tf ?? {})) {
    const m = KEY_RE.exec(key);
    if (!m || !(key in loaded.values)) continue;
    if (raw.trim() === (loaded.values[key] ?? "").trim()) continue;
    values[m[1]] = raw.trim() === "" ? null : raw;
  }
  const levels: Record<string, TagFieldLevel | null> = {};
  for (const [key, raw] of Object.entries(tfv ?? {})) {
    const m = KEY_RE.exec(key);
    if (!m || !(key in loaded.levels)) continue;
    if (raw === (loaded.levels[key] ?? "")) continue;
    levels[m[1]] = isTagFieldLevel(raw) ? raw : null;
  }
  return {
    ...(Object.keys(values).length > 0 ? { tag_values: values } : {}),
    ...(Object.keys(levels).length > 0 ? { tag_value_visibility: levels } : {}),
  };
};
