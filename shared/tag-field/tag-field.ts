/**
 * Fields of a tag (admin migration 0010): a tag such as 「フィルム」 defines
 * fields (フィルム銘柄, ISO, …) that every photo with the tag can fill in.
 * Shared by the admin, which checks what is typed (in the browser and on
 * the server), and the API Worker, which reads the stored values again
 * and decides what is public (publicTagFields). Plain TS, no dependencies.
 *
 * Values are stored per photo in `media.tag_values`, a JSON object keyed
 * by the field's id (as a string); the photo's own levels in
 * `media.tag_value_visibility`, keyed the same way.
 */

export const TAG_FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type TagFieldType = (typeof TAG_FIELD_TYPES)[number];

export const TAG_FIELD_TYPE_LABELS: Record<TagFieldType, string> = {
  text: "テキスト",
  number: "数値",
  date: "日付",
  select: "選択肢",
};

/** A field's public level: its default, or a photo's own. */
export const TAG_FIELD_LEVELS = ["shown", "hidden"] as const;
export type TagFieldLevel = (typeof TAG_FIELD_LEVELS)[number];

export const TAG_FIELD_LEVEL_LABELS: Record<TagFieldLevel, string> = {
  shown: "出す",
  hidden: "出さない",
};

export const TAG_FIELD_LIMITS = {
  /** Characters in a label (the migration's CHECK). */
  label: 40,
  /** Characters in a text value. */
  text: 200,
  /** Characters in one option, and options per field (the CHECK). */
  option: 60,
  options: 50,
  /** Fields per tag. */
  fields: 20,
} as const;

export type TagFieldValue = string | number;

/** One field as the code uses it. */
export type TagFieldDef = {
  id: number;
  /** The tag's name. */
  tag: string;
  label: string;
  type: TagFieldType;
  /** The choices of a select field, else null. */
  options: string[] | null;
  /** Its default public level. */
  visibility: TagFieldLevel;
  position: number;
};

export const isTagFieldType = (v: unknown): v is TagFieldType =>
  (TAG_FIELD_TYPES as readonly unknown[]).includes(v);

export const isTagFieldLevel = (v: unknown): v is TagFieldLevel =>
  v === "shown" || v === "hidden";

type Invalid = { ok: false; error: string };

// Control characters (incl. newlines) have no place in a one-line value.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const cleanText = (s: string) => s.normalize("NFC").trim();

/** Options as typed in a textarea: one per line, blanks dropped. */
export const parseOptionsText = (text: string): string[] =>
  text.split(/\r?\n/).map(cleanText).filter(Boolean);

/** A label as typed: trimmed, 1–40 characters on one line. */
export const validateLabel = (
  raw: unknown,
): { ok: true; value: string } | Invalid => {
  if (typeof raw !== "string")
    return { ok: false, error: "項目名がありません" };
  const label = cleanText(raw);
  if (label === "") return { ok: false, error: "項目名を入れてください" };
  if (label.length > TAG_FIELD_LIMITS.label) {
    return {
      ok: false,
      error: `項目名は ${TAG_FIELD_LIMITS.label} 文字までです`,
    };
  }
  if (CONTROL_RE.test(label)) {
    return { ok: false, error: "項目名に改行は入れられません" };
  }
  return { ok: true, value: label };
};

/** A select field's options: 1–50 distinct non-empty lines. */
export const validateOptions = (
  raw: unknown,
): { ok: true; value: string[] } | Invalid => {
  if (!Array.isArray(raw) || !raw.every((o) => typeof o === "string")) {
    return { ok: false, error: "選択肢がありません" };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw.map(cleanText)) {
    if (o === "" || seen.has(o)) continue;
    if (o.length > TAG_FIELD_LIMITS.option || CONTROL_RE.test(o)) {
      return {
        ok: false,
        error: `選択肢は 1 行 ${TAG_FIELD_LIMITS.option} 文字までです`,
      };
    }
    seen.add(o);
    out.push(o);
  }
  if (out.length === 0) {
    return { ok: false, error: "選択肢を 1 つ以上入れてください" };
  }
  if (out.length > TAG_FIELD_LIMITS.options) {
    return {
      ok: false,
      error: `選択肢は ${TAG_FIELD_LIMITS.options} 個までです`,
    };
  }
  return { ok: true, value: out };
};

/** A new field: its label, type and (for select) options. */
export const validateFieldInput = (input: {
  label: unknown;
  type: unknown;
  options?: unknown;
}):
  | {
      ok: true;
      value: { label: string; type: TagFieldType; options: string[] | null };
    }
  | Invalid => {
  const label = validateLabel(input.label);
  if (!label.ok) return label;
  if (!isTagFieldType(input.type)) {
    return { ok: false, error: "種類を選んでください" };
  }
  if (input.type !== "select") {
    return {
      ok: true,
      value: { label: label.value, type: input.type, options: null },
    };
  }
  const options = validateOptions(input.options);
  if (!options.ok) return options;
  return {
    ok: true,
    value: { label: label.value, type: "select", options: options.value },
  };
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isDateValue = (s: string): boolean => {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    +m[1] >= 1 &&
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
};

/** Plain decimal numbers ("400", "-0.5", "1.8"), after NFKC (full width). */
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const MAX_NUMBER = 1e15;

/**
 * A value as typed for a field, normalized for storing: "" (or null) is
 * none (null); text is trimmed (one line, up to 200 characters); a number
 * is a JSON number; a date is YYYY-MM-DD; a select value must be one of
 * its options.
 */
export const normalizeValue = (
  def: Pick<TagFieldDef, "label" | "type" | "options">,
  raw: unknown,
): { ok: true; value: TagFieldValue | null } | Invalid => {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (def.type === "number" && typeof raw === "number") {
    return Number.isFinite(raw) && Math.abs(raw) < MAX_NUMBER
      ? { ok: true, value: raw }
      : { ok: false, error: `${def.label}は数値です` };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${def.label}の値が読めません` };
  }
  const s = cleanText(raw);
  if (s === "") return { ok: true, value: null };
  switch (def.type) {
    case "text":
      if (s.length > TAG_FIELD_LIMITS.text) {
        return {
          ok: false,
          error: `${def.label}は ${TAG_FIELD_LIMITS.text} 文字までです`,
        };
      }
      if (CONTROL_RE.test(s)) {
        return { ok: false, error: `${def.label}に改行は入れられません` };
      }
      return { ok: true, value: s };
    case "number": {
      const n = s.normalize("NFKC").replace(/,/g, "");
      const v = Number(n);
      if (
        !NUMBER_RE.test(n) ||
        !Number.isFinite(v) ||
        Math.abs(v) >= MAX_NUMBER
      ) {
        return { ok: false, error: `${def.label}は数値です` };
      }
      // + 0 turns -0 into 0.
      return { ok: true, value: v + 0 };
    }
    case "date":
      return isDateValue(s)
        ? { ok: true, value: s }
        : { ok: false, error: `${def.label}は YYYY-MM-DD の日付です` };
    case "select":
      return (def.options ?? []).includes(s)
        ? { ok: true, value: s }
        : { ok: false, error: `${def.label}は選択肢から選んでください` };
  }
};

/**
 * A stored value read back, leniently: what a field of this type can
 * hold, else null. A select value that is no longer among the options is
 * kept (it was valid when it was saved).
 */
export const readValue = (
  type: TagFieldType,
  v: unknown,
): TagFieldValue | null => {
  if (type === "number") {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  if (typeof v !== "string" || v === "" || CONTROL_RE.test(v)) return null;
  if (v.length > TAG_FIELD_LIMITS.text) return null;
  if (type === "date" && !isDateValue(v)) return null;
  return v;
};

const parseObject = (raw: string | null | undefined) => {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** media.tag_values read leniently: field id → stored value. */
export const parseValueMap = (
  raw: string | null | undefined,
): Record<string, unknown> => parseObject(raw);

/**
 * media.tag_value_visibility read leniently: field id → level. A value
 * that is not a level is "hidden" (fail closed).
 */
export const parseLevelMap = (
  raw: string | null | undefined,
): Record<string, TagFieldLevel> => {
  const out: Record<string, TagFieldLevel> = {};
  for (const [k, v] of Object.entries(parseObject(raw))) {
    if (v === null) continue;
    out[k] = isTagFieldLevel(v) ? v : "hidden";
  }
  return out;
};

/** A field's level on one photo: its own, else the field's. */
export const levelOf = (
  def: Pick<TagFieldDef, "id" | "visibility">,
  levels: Record<string, TagFieldLevel>,
): TagFieldLevel => levels[String(def.id)] ?? def.visibility;

/** One field of a photo as the public API returns it. */
export type PublicTagField = {
  tag: string;
  label: string;
  value: TagFieldValue;
};

/**
 * The fields a photo shows publicly: for each tag in `shownTags` (the
 * photo's tags the public site shows, in their order: only public tags,
 * and none when its tags level hides them), that tag's fields in order
 * whose level on this photo is "shown" and which have a valid value.
 * `defs` may hold any fields; only those of `shownTags` count.
 */
export const publicTagFields = (
  shownTags: readonly string[],
  defs: readonly TagFieldDef[],
  valuesRaw: string | null | undefined,
  levelsRaw: string | null | undefined,
): PublicTagField[] => {
  if (shownTags.length === 0 || defs.length === 0) return [];
  const values = parseValueMap(valuesRaw);
  const levels = parseLevelMap(levelsRaw);
  const out: PublicTagField[] = [];
  for (const tag of shownTags) {
    const fields = defs
      .filter((d) => d.tag === tag)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    for (const def of fields) {
      if (levelOf(def, levels) !== "shown") continue;
      const value = readValue(def.type, values[String(def.id)]);
      if (value === null) continue;
      out.push({ tag, label: def.label, value });
    }
  }
  return out;
};

/** A field row (tag_field joined with its tag's name) read leniently. */
export const rowToDef = (row: {
  id: number;
  tag: string;
  label: string;
  type: string;
  options: string | null;
  visibility: string;
  position: number;
}): TagFieldDef | null => {
  if (!isTagFieldType(row.type)) return null;
  let options: string[] | null = null;
  if (row.type === "select") {
    try {
      const v: unknown = JSON.parse(row.options ?? "null");
      options = Array.isArray(v)
        ? v.filter((o): o is string => typeof o === "string")
        : [];
    } catch {
      options = [];
    }
  }
  return {
    id: row.id,
    tag: row.tag,
    label: row.label,
    type: row.type,
    options,
    // Unknown counts as hidden, like every level.
    visibility: row.visibility === "shown" ? "shown" : "hidden",
    position: row.position,
  };
};

/** A value as the pages show it. */
export const formatValue = (value: TagFieldValue): string =>
  // Plain decimals (never 1e-7), so a shown number can be saved again.
  typeof value === "number"
    ? value.toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 20,
      })
    : value;
