// The Files view's タグの項目 sheet (components/bulk-tag-field-dialog.tsx):
// the fields of the selected photos' tags, each starting at the value the
// photos with that tag share, or empty with そのまま when they differ.
// Pure; bulk-tag-field.spec.ts.

import {
  formatValue,
  readValue,
  type TagFieldDef,
} from "@shared/tag-field/tag-field";

/** A selected photo's tags and stored values (db-tag-field.ts). */
export type PhotoTagValues = {
  id: number;
  tags: string[];
  values: Record<string, unknown>;
};

export type SharedField = {
  field: TagFieldDef;
  /** Selected photos with the field's tag (the ones a change reaches). */
  count: number;
  /** The value they all have ("" for none), or null when they differ. */
  value: string | null;
};

/** The tags with fields among the photos, in order of first appearance. */
export const tagsWithFields = (
  tags: readonly (readonly string[])[],
  fields: readonly TagFieldDef[],
): string[] => {
  const out: string[] = [];
  for (const list of tags) {
    for (const t of list) {
      if (!out.includes(t) && fields.some((f) => f.tag === t)) out.push(t);
    }
  }
  return out;
};

/** Each field of the photos' tags with what the photos share. */
export const sharedFields = (
  photos: readonly PhotoTagValues[],
  fields: readonly TagFieldDef[],
): SharedField[] => {
  const out: SharedField[] = [];
  for (const tag of tagsWithFields(
    photos.map((p) => p.tags),
    fields,
  )) {
    const having = photos.filter((p) => p.tags.includes(tag));
    for (const field of fields.filter((f) => f.tag === tag)) {
      const texts = new Set(
        having.map((p) => {
          const v = readValue(field.type, p.values[String(field.id)]);
          return v === null ? "" : formatValue(v);
        }),
      );
      out.push({
        field,
        count: having.length,
        value: texts.size === 1 ? [...texts][0] : null,
      });
    }
  }
  return out;
};

/**
 * The change the sheet makes: for each field, the typed value when it
 * differs from what the photos share ("" clears: null), and the fields
 * cleared with × (null). Untouched fields are left out.
 */
export const bulkTagChange = (
  shared: readonly SharedField[],
  typed: Record<string, string>,
  cleared: readonly number[],
): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const s of shared) {
    const id = s.field.id;
    const raw = (typed[String(id)] ?? "").trim();
    if (cleared.includes(id) && raw === "") {
      if (s.value !== "") out[String(id)] = null;
      continue;
    }
    if (raw === "") {
      // Empty: none for photos that share a value, else untouched.
      if (s.value !== null && s.value !== "") out[String(id)] = null;
      continue;
    }
    if (raw !== s.value) out[String(id)] = raw;
  }
  return out;
};
