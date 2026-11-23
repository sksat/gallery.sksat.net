// Platforms (migration 0014_platform.sql): where a photo was taken. Rows
// of the `platform` table, edited on /platform/; media.platform stores the
// key. Pure helpers here, the D1 side in db-platform.ts.

/** 'real': the real world; 'virtual': a VR platform, with no real place. */
export const PLATFORM_KINDS = ["real", "virtual"] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

export const PLATFORM_KIND_LABELS: Record<PlatformKind, string> = {
  real: "現実",
  virtual: "バーチャル",
};

export const isPlatformKind = (v: unknown): v is PlatformKind =>
  v === "real" || v === "virtual";

export type Platform = {
  /** media.platform; fixed when added. */
  key: string;
  /** What the admin and the public site show. */
  name: string;
  kind: PlatformKind;
};

/**
 * The platform whose own metadata the admin knows: its world (wrld_…,
 * linked on vrchat.com), its XMP (vrc:*) and its screenshot file names.
 */
export const VRCHAT = "VRChat";

/** Where an upload goes unless it looks like VRChat's (upload.ts). */
export const REAL = "Real";

/**
 * The platforms 0014 starts with (and what is shown without D1). Uploads
 * pick one of them, so they can be renamed but never deleted.
 */
export const BUILTIN_PLATFORMS: readonly Platform[] = [
  { key: REAL, name: "Real", kind: "real" },
  { key: VRCHAT, name: "VRChat", kind: "virtual" },
];

export const isBuiltinPlatform = (key: string): boolean =>
  BUILTIN_PLATFORMS.some((p) => p.key === key);

/** A key as the table's CHECK allows (it goes into ?platform= URLs). */
export const PLATFORM_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export const isPlatformKey = (v: unknown): v is string =>
  typeof v === "string" && PLATFORM_KEY_RE.test(v);

export const PLATFORM_NAME_MAX = 40;

/**
 * The platform with `key` in `list`; a key missing from it (the list could
 * not be read) is shown as itself, VRChat's kind kept.
 */
export const platformOf = (list: readonly Platform[], key: string): Platform =>
  list.find((p) => p.key === key) ??
  BUILTIN_PLATFORMS.find((p) => p.key === key) ?? {
    key,
    name: key,
    kind: "real",
  };

/** Whether photos on this platform can have a real-world position. */
export const hasRealPlace = (kind: PlatformKind): boolean => kind === "real";

export const validatePlatformName = (
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: string } => {
  if (typeof raw !== "string") return { ok: false, error: "名前がありません" };
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "名前を入れてください" };
  if (name.length > PLATFORM_NAME_MAX) {
    return {
      ok: false,
      error: `名前は ${PLATFORM_NAME_MAX} 文字までです`,
    };
  }
  return { ok: true, name };
};

/**
 * The key of a new platform named `name`: its letters and digits, other
 * runs as "-" ("Neos VR" → "Neos-VR"), or "platform" when none are left;
 * numbered (-2, -3, …) past the keys taken, case aside.
 */
export const platformKeyFor = (
  name: string,
  taken: readonly string[],
): string => {
  const base =
    name
      .normalize("NFKD")
      // Accents off ("Résonite" → "Resonite").
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28)
      .replace(/-+$/, "") || "platform";
  const used = new Set(taken.map((k) => k.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const key = `${base}-${n}`;
    if (!used.has(key.toLowerCase())) return key;
  }
};
