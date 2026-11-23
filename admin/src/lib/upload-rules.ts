// Upload rules: what a new photo gets from the file it came from (its
// platform, camera, tags, visibility and public metadata levels), set by
// the owner on /setting/upload-rule/ instead of hard-coded. Stored as one
// `setting` row ('upload_rules', a JSON array; migration 0005). Pure and
// shared by the server (applied at upload init, so they cannot be
// skipped), the rules page and "apply to existing photos"; covered by
// upload-rules.spec.ts.
//
// A rule matches when all its conditions do (no condition: never, so an
// empty rule does nothing by accident). Every matching rule contributes;
// per field the first matching rule wins (the list is in priority order,
// top first), and tags add up.

import { validateFolderPath } from "./folders";
import { displaySize } from "./image-size";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  LEVEL_LABELS,
  isLevel,
  type EditableField,
  type MetadataOverrides,
} from "./metadata";
import type { ExifJSON } from "./photo-meta";
import { isPlatformKey, REAL, VRCHAT } from "./platform";
import { isVisibility, type MediaPlatform, type Visibility } from "./types";

export const UPLOAD_RULES_KEY = "upload_rules";

// Current VRChat names put the resolution last
// (VRChat_2026-11-18_01-02-03.456_3840x2160.png); before late 2022 it came
// first (VRChat_3840x2160_2022-08-22_02-03-18.591.png).
export const VRCHAT_NAME_RE =
  /^VRChat_(?:\d+x\d+_)?(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)\.(\d{3})(?:_\d+x\d+)?\.png$/;

/** Named file name patterns (things a glob cannot say). */
export const NAME_PRESETS = {
  vrchat: { label: "VRChat のファイル名", re: VRCHAT_NAME_RE },
} as const;
export type NamePreset = keyof typeof NAME_PRESETS;

export const EXTENSIONS = ["png", "jpg"] as const;
export type Extension = (typeof EXTENSIONS)[number];

export const ORIENTATIONS = ["landscape", "portrait", "square"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  landscape: "横長",
  portrait: "縦長",
  square: "正方形",
};

export type RuleConditions = {
  /** In this folder or below ("/VRChat"). */
  folder?: string;
  /** The file name: a glob (* and ?, any case) or a named pattern. */
  name?: { glob: string } | { preset: NamePreset };
  ext?: Extension;
  /** XMP CreatorTool contains this (any case). */
  creatorTool?: string;
  /** Has (true) or lacks (false) a VRChat world. */
  world?: boolean;
  /** EXIF make or model contains this (any case). */
  camera?: string;
  orientation?: Orientation;
  /** Has (true) or lacks (false) a GPS position. */
  gps?: boolean;
};

export type RuleActions = {
  platform?: MediaPlatform;
  cameraId?: number;
  tags?: string[];
  visibility?: Visibility;
  metadata?: MetadataOverrides;
};

export type UploadRule = {
  id: string;
  /** "" = described from its conditions. */
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
};

/** Today's behaviour before rules existed: VRChat by folder or name. */
export const DEFAULT_UPLOAD_RULES: readonly UploadRule[] = [
  {
    id: "vrchat-folder",
    name: "/VRChat/ フォルダ",
    enabled: true,
    conditions: { folder: "/VRChat" },
    actions: { platform: VRCHAT },
  },
  {
    id: "vrchat-name",
    name: "VRChat のファイル名",
    enabled: true,
    conditions: { name: { preset: "vrchat" } },
    actions: { platform: VRCHAT },
  },
];

/** Platform when no rule sets one. */
export const FALLBACK_PLATFORM: MediaPlatform = REAL;

/**
 * What is known about a photo. `undefined` = unknown (a photo uploaded
 * before rules existed has no CreatorTool or size stored): a condition on
 * an unknown fact does not match.
 */
export type RuleFacts = {
  /** Where it goes ("/VRChat/2026-11/a.png"). */
  path: string;
  creatorTool?: string | null;
  /** Unknown while the file's metadata has not been read. */
  hasWorld?: boolean;
  exif: ExifJSON | null;
  dimensions?: { width: number; height: number } | null;
  hasGps?: boolean;
};

const lower = (s: string) => s.toLowerCase();

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const extOf = (path: string): string => {
  const name = baseName(path);
  const i = name.lastIndexOf(".");
  const e = i < 0 ? "" : lower(name.slice(i + 1));
  return e === "jpeg" ? "jpg" : e;
};

/** At most this many `*` in a glob (each one more can backtrack more). */
export const MAX_GLOB_STARS = 4;

/**
 * A glob (* any run, ? one character) as an anchored, any-case RegExp.
 * Runs of `*` count as one.
 */
export const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${Array.from(glob.replace(/\*+/g, "*"), (c) =>
      c === "*"
        ? ".*"
        : c === "?"
          ? "."
          : c.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    ).join("")}$`,
    "is",
  );

/** Width and height as seen (EXIF orientations 5–8 turn it a quarter). */
const shownOrientation = (
  d: { width: number; height: number },
  exifOrientation: number | undefined,
): Orientation => {
  const { width: w, height: h } = displaySize(d, exifOrientation);
  return w === h ? "square" : w > h ? "landscape" : "portrait";
};

export const matchesConditions = (c: RuleConditions, f: RuleFacts): boolean => {
  let any = false;
  const check = (ok: boolean) => {
    any = true;
    return ok;
  };
  if (c.folder !== undefined && !check(f.path.startsWith(`${c.folder}/`))) {
    return false;
  }
  if (c.name !== undefined) {
    const name = baseName(f.path);
    const ok =
      "preset" in c.name
        ? NAME_PRESETS[c.name.preset].re.test(name)
        : globToRegExp(c.name.glob).test(name);
    if (!check(ok)) return false;
  }
  if (c.ext !== undefined && !check(extOf(f.path) === c.ext)) return false;
  if (c.creatorTool !== undefined) {
    const t = f.creatorTool;
    if (!check(!!t && lower(t).includes(lower(c.creatorTool)))) return false;
  }
  if (
    c.world !== undefined &&
    !check(f.hasWorld !== undefined && f.hasWorld === c.world)
  ) {
    return false;
  }
  if (c.camera !== undefined) {
    const text = lower(`${f.exif?.make ?? ""} ${f.exif?.model ?? ""}`);
    if (!check(text.includes(lower(c.camera)))) return false;
  }
  if (c.orientation !== undefined) {
    const d = f.dimensions;
    const ok =
      !!d && shownOrientation(d, f.exif?.orientation) === c.orientation;
    if (!check(ok)) return false;
  }
  if (
    c.gps !== undefined &&
    !check(f.hasGps !== undefined && f.hasGps === c.gps)
  ) {
    return false;
  }
  return any;
};

/** A value and the rule that set it. */
export type Decided<T> = { value: T; ruleId: string };

export type UploadDecisions = {
  platform: Decided<MediaPlatform> | null;
  cameraId: Decided<number> | null;
  tags: Decided<string>[];
  visibility: Decided<Visibility> | null;
  metadata: Partial<Record<EditableField, Decided<string>>>;
};

export const emptyDecisions = (): UploadDecisions => ({
  platform: null,
  cameraId: null,
  tags: [],
  visibility: null,
  metadata: {},
});

/**
 * What the rules decide for a photo: per field the first enabled rule
 * that matches and sets it; tags from every matching rule, in order.
 */
export const applyUploadRules = (
  rules: readonly UploadRule[],
  facts: RuleFacts,
): UploadDecisions => {
  const d = emptyDecisions();
  for (const rule of rules) {
    if (!rule.enabled || !matchesConditions(rule.conditions, facts)) continue;
    const a = rule.actions;
    const by = <T>(value: T): Decided<T> => ({ value, ruleId: rule.id });
    if (a.platform !== undefined && !d.platform) d.platform = by(a.platform);
    if (a.cameraId !== undefined && !d.cameraId) d.cameraId = by(a.cameraId);
    if (a.visibility !== undefined && !d.visibility) {
      d.visibility = by(a.visibility);
    }
    for (const t of a.tags ?? []) {
      if (!d.tags.some((x) => x.value === t)) d.tags.push(by(t));
    }
    for (const [k, v] of Object.entries(a.metadata ?? {})) {
      const f = k as EditableField;
      if (v !== undefined && !d.metadata[f]) d.metadata[f] = by(v);
    }
  }
  return d;
};

/** The metadata levels decided, as a photo's overrides. */
export const decidedLevels = (d: UploadDecisions): MetadataOverrides =>
  Object.fromEntries(
    Object.entries(d.metadata).map(([k, v]) => [k, v.value]),
  ) as MetadataOverrides;

// --- Storage and validation ----------------------------------------------

export const MAX_RULES = 50;
export const MAX_RULE_NAME = 60;
export const MAX_RULE_TEXT = 100;
export const MAX_RULE_TAGS = 20;
const MAX_TAG_LEN = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (
  v: unknown,
  what: string,
  max = MAX_RULE_TEXT,
): Result<string> => {
  if (typeof v !== "string") return { ok: false, error: `${what}: 文字列` };
  const s = v.trim();
  if (s === "") return { ok: false, error: `${what}が空です` };
  if (s.length > max) return { ok: false, error: `${what}が長すぎます` };
  return { ok: true, value: s };
};

const conditions = (v: unknown): Result<RuleConditions> => {
  if (!isObject(v)) return { ok: false, error: "条件がありません" };
  const out: RuleConditions = {};
  if (v.folder !== undefined) {
    // "/VRChat/" and "VRChat" are taken as "/VRChat".
    const raw =
      typeof v.folder === "string"
        ? `/${v.folder.trim().replace(/^\/+|\/+$/g, "")}`
        : v.folder;
    const f = validateFolderPath(raw);
    if (!f.ok) {
      return { ok: false, error: "フォルダは /VRChat のように書いてください" };
    }
    out.folder = f.path;
  }
  if (v.name !== undefined) {
    const n = v.name;
    if (
      isObject(n) &&
      typeof n.preset === "string" &&
      n.preset in NAME_PRESETS
    ) {
      out.name = { preset: n.preset as NamePreset };
    } else if (isObject(n) && n.glob !== undefined) {
      const g = text(n.glob, "ファイル名のパターン");
      if (!g.ok) return g;
      if ((g.value.match(/\*+/g) ?? []).length > MAX_GLOB_STARS) {
        return {
          ok: false,
          error: `パターンの * は ${MAX_GLOB_STARS} か所までです`,
        };
      }
      out.name = { glob: g.value };
    } else return { ok: false, error: "ファイル名の条件が不正です" };
  }
  if (v.ext !== undefined) {
    if (!(EXTENSIONS as readonly unknown[]).includes(v.ext)) {
      return { ok: false, error: "拡張子が不正です" };
    }
    out.ext = v.ext as Extension;
  }
  for (const key of ["creatorTool", "camera"] as const) {
    if (v[key] === undefined) continue;
    const t = text(v[key], key === "camera" ? "カメラ (EXIF)" : "作成ソフト");
    if (!t.ok) return t;
    out[key] = t.value;
  }
  for (const key of ["world", "gps"] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== "boolean") return { ok: false, error: `${key}` };
    out[key] = v[key];
  }
  if (v.orientation !== undefined) {
    if (!(ORIENTATIONS as readonly unknown[]).includes(v.orientation)) {
      return { ok: false, error: "向きが不正です" };
    }
    out.orientation = v.orientation as Orientation;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: "条件を 1 つ以上選んでください" };
  }
  return { ok: true, value: out };
};

const actions = (v: unknown): Result<RuleActions> => {
  if (!isObject(v)) return { ok: false, error: "動作がありません" };
  const out: RuleActions = {};
  if (v.platform !== undefined) {
    // Whether it exists is checked against D1 when saving (like cameras).
    if (!isPlatformKey(v.platform)) return { ok: false, error: "Platform" };
    out.platform = v.platform;
  }
  if (v.cameraId !== undefined) {
    const n = v.cameraId;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) {
      return { ok: false, error: "カメラが不正です" };
    }
    out.cameraId = n;
  }
  if (v.tags !== undefined) {
    if (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === "string")) {
      return { ok: false, error: "タグが不正です" };
    }
    const tags = [
      ...new Set((v.tags as string[]).map((t) => t.trim()).filter(Boolean)),
    ];
    if (
      tags.length > MAX_RULE_TAGS ||
      tags.some((t) => t.length > MAX_TAG_LEN)
    ) {
      return { ok: false, error: "タグが多すぎるか長すぎます" };
    }
    if (tags.length > 0) out.tags = tags;
  }
  if (v.visibility !== undefined) {
    if (!isVisibility(v.visibility)) return { ok: false, error: "公開範囲" };
    out.visibility = v.visibility;
  }
  if (v.metadata !== undefined) {
    if (!isObject(v.metadata)) return { ok: false, error: "公開する情報" };
    const m: Record<string, string> = {};
    for (const [k, level] of Object.entries(v.metadata)) {
      if (!(EDITABLE_FIELDS as readonly string[]).includes(k)) {
        return { ok: false, error: `公開する情報: ${k}` };
      }
      if (level === "" || level === null || level === undefined) continue;
      if (!isLevel(k as EditableField, level)) {
        return { ok: false, error: `公開する情報: ${k}` };
      }
      m[k] = level as string;
    }
    if (Object.keys(m).length > 0) out.metadata = m as MetadataOverrides;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: "決めることを 1 つ以上選んでください" };
  }
  return { ok: true, value: out };
};

export const validateRule = (v: unknown): Result<UploadRule> => {
  if (!isObject(v)) return { ok: false, error: "ルールが不正です" };
  if (typeof v.id !== "string" || !ID_RE.test(v.id)) {
    return { ok: false, error: "ルールの id が不正です" };
  }
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (name.length > MAX_RULE_NAME) {
    return { ok: false, error: "名前が長すぎます" };
  }
  const c = conditions(v.conditions);
  if (!c.ok) return c;
  const a = actions(v.actions);
  if (!a.ok) return a;
  return {
    ok: true,
    value: {
      id: v.id,
      name,
      enabled: v.enabled !== false,
      conditions: c.value,
      actions: a.value,
    },
  };
};

/** A whole list from a request: every rule valid, ids unique. */
export const validateRules = (v: unknown): Result<UploadRule[]> => {
  if (!Array.isArray(v)) return { ok: false, error: "ルールの一覧が不正です" };
  if (v.length > MAX_RULES) {
    return { ok: false, error: `ルールは ${MAX_RULES} 個までです` };
  }
  const out: UploadRule[] = [];
  for (const r of v) {
    const res = validateRule(r);
    if (!res.ok) return res;
    if (out.some((x) => x.id === res.value.id)) {
      return { ok: false, error: "ルールの id が重複しています" };
    }
    out.push(res.value);
  }
  return { ok: true, value: out };
};

/**
 * The stored rules, read leniently: no row = the defaults; a rule that
 * no longer validates is left out rather than breaking uploads.
 */
export const parseStoredRules = (
  raw: string | null | undefined,
): UploadRule[] => {
  if (raw == null) return DEFAULT_UPLOAD_RULES.map((r) => structuredClone(r));
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    const res = validateRule(r);
    return res.ok ? [res.value] : [];
  });
};

// --- Labels --------------------------------------------------------------

export type CameraNames = ReadonlyMap<number, string>;

/** One condition each, as short text ("フォルダ /VRChat"). */
export const conditionLabels = (c: RuleConditions): string[] => {
  const out: string[] = [];
  if (c.folder !== undefined) out.push(`${c.folder}/ フォルダ`);
  if (c.name !== undefined) {
    out.push(
      "preset" in c.name
        ? NAME_PRESETS[c.name.preset].label
        : `ファイル名 ${c.name.glob}`,
    );
  }
  if (c.ext !== undefined) out.push(`.${c.ext}`);
  if (c.creatorTool !== undefined) out.push(`作成ソフト「${c.creatorTool}」`);
  if (c.world !== undefined)
    out.push(c.world ? "ワールドあり" : "ワールドなし");
  if (c.camera !== undefined) out.push(`EXIF カメラ「${c.camera}」`);
  if (c.orientation !== undefined) out.push(ORIENTATION_LABELS[c.orientation]);
  if (c.gps !== undefined) out.push(c.gps ? "位置情報あり" : "位置情報なし");
  return out;
};

export const VISIBILITY_LABEL_JA: Record<Visibility, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

export const cameraLabel = (id: number, cameras: CameraNames): string =>
  cameras.get(id) ?? `カメラ #${id}`;

/** A metadata level as "撮影場所: 出さない". */
export const levelLabel = (field: EditableField, level: string): string =>
  `${FIELD_LABELS[field]}: ${(LEVEL_LABELS[field] as Record<string, string>)[level] ?? level}`;

/** One action each, as short text. */
export const actionLabels = (
  a: RuleActions,
  cameras: CameraNames,
  /** A platform's name by key (the key itself by default). */
  platformName: (key: string) => string = (k) => k,
): string[] => {
  const out: string[] = [];
  if (a.platform !== undefined) out.push(platformName(a.platform));
  if (a.cameraId !== undefined) out.push(cameraLabel(a.cameraId, cameras));
  for (const t of a.tags ?? []) out.push(`#${t}`);
  if (a.visibility !== undefined) out.push(VISIBILITY_LABEL_JA[a.visibility]);
  for (const f of EDITABLE_FIELDS) {
    const level = a.metadata?.[f];
    if (level !== undefined) out.push(levelLabel(f, level));
  }
  return out;
};

/** The rule's name, or its conditions when it has none. */
export const ruleTitle = (r: UploadRule): string =>
  r.name || conditionLabels(r.conditions).join(" + ") || "ルール";

/** What a decision shows on the upload panel: "VRChat ← /VRChat/ フォルダ". */
export type AppliedChip = { field: string; value: string; rule: string };

export const appliedChips = (
  d: UploadDecisions,
  rules: readonly UploadRule[],
  cameras: CameraNames,
): AppliedChip[] => {
  const title = (id: string) => {
    const r = rules.find((x) => x.id === id);
    return r ? ruleTitle(r) : id;
  };
  const out: AppliedChip[] = [];
  if (d.platform) {
    out.push({
      field: "platform",
      value: d.platform.value,
      rule: title(d.platform.ruleId),
    });
  }
  if (d.cameraId) {
    out.push({
      field: "camera",
      value: cameraLabel(d.cameraId.value, cameras),
      rule: title(d.cameraId.ruleId),
    });
  }
  for (const t of d.tags) {
    out.push({ field: "tag", value: `#${t.value}`, rule: title(t.ruleId) });
  }
  if (d.visibility) {
    out.push({
      field: "visibility",
      value: VISIBILITY_LABEL_JA[d.visibility.value],
      rule: title(d.visibility.ruleId),
    });
  }
  for (const f of EDITABLE_FIELDS) {
    const m = d.metadata[f];
    if (m)
      out.push({
        field: `metadata.${f}`,
        value: levelLabel(f, m.value),
        rule: title(m.ruleId),
      });
  }
  return out;
};

// --- Existing photos -----------------------------------------------------

/**
 * Which photos 既存の写真に適用 works on: every photo only when that was
 * chosen (`all`), else the typed folder and below. The folder is checked
 * as typed, never normalised: an empty, "/", "." or ".." folder is
 * refused rather than turning into "every photo". Returns "/" for all.
 */
export const applyScope = (
  all: boolean,
  raw: string,
): { ok: true; folder: string } | { ok: false; error: string } => {
  if (all) return { ok: true, folder: "/" };
  const s = raw.trim();
  if (s === "") return { ok: false, error: "フォルダを入力してください" };
  // "/VRChat/" and "VRChat" mean "/VRChat"; nothing else is rewritten.
  const path = `/${s.replace(/^\/|\/$/g, "")}`;
  const v = path === "/" ? null : validateFolderPath(path);
  if (!v?.ok) {
    return { ok: false, error: "フォルダは /VRChat のように書いてください" };
  }
  return { ok: true, folder: v.path };
};

/** The parts of a stored photo the rules may fill in. */
export type ExistingPhoto = {
  id: number;
  platform: MediaPlatform;
  camera_id: number | null;
  /** Its camera was chosen or cleared by hand (metadata_source.camera). */
  cameraManual?: boolean;
  tags: string[];
  metadata_visibility: MetadataOverrides;
};

/** What applying the rules changes on one photo (only what differs). */
export type ExistingChange = {
  id: number;
  platform?: MediaPlatform;
  camera_id?: number;
  tags?: string[];
  metadata_visibility?: MetadataOverrides;
  /** Rules that changed something. */
  ruleIds: string[];
};

/**
 * What the rules would change on a photo that is already uploaded. Only
 * values that cannot have been chosen by hand are filled in, since what
 * was set by hand is not recorded for most of these fields: the platform
 * only while it is the fallback (Real), the camera only when there is none
 * and none was cleared by hand (metadata_source.camera), tags only added,
 * metadata levels only for fields that follow the site.
 * Visibility is never changed here. Null when nothing changes.
 */
export const existingChange = (
  photo: ExistingPhoto,
  d: UploadDecisions,
): ExistingChange | null => {
  const change: ExistingChange = { id: photo.id, ruleIds: [] };
  const by = (id: string) => {
    if (!change.ruleIds.includes(id)) change.ruleIds.push(id);
  };
  if (
    d.platform &&
    photo.platform === FALLBACK_PLATFORM &&
    d.platform.value !== photo.platform
  ) {
    change.platform = d.platform.value;
    by(d.platform.ruleId);
  }
  if (d.cameraId && photo.camera_id === null && !photo.cameraManual) {
    change.camera_id = d.cameraId.value;
    by(d.cameraId.ruleId);
  }
  const newTags = d.tags.filter((t) => !photo.tags.includes(t.value));
  if (newTags.length > 0) {
    change.tags = [...photo.tags, ...newTags.map((t) => t.value)];
    newTags.forEach((t) => by(t.ruleId));
  }
  const levels: Record<string, string> = { ...photo.metadata_visibility };
  let levelsChanged = false;
  for (const f of EDITABLE_FIELDS) {
    const m = d.metadata[f];
    if (m && levels[f] === undefined) {
      levels[f] = m.value;
      levelsChanged = true;
      by(m.ruleId);
    }
  }
  if (levelsChanged) change.metadata_visibility = levels as MetadataOverrides;
  return change.ruleIds.length > 0 ? change : null;
};
