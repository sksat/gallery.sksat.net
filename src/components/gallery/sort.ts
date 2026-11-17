/**
 * Display order of the gallery, kept in the URL (`?sort=old`,
 * `?sort=random&seed=123`) like the tag filter.
 */
import type { MediaInfo } from "./types";

export type SortKind = "new" | "old" | "random";

export type SortOrder = {
  kind: SortKind;
  /** Only used by "random": the same seed gives the same order. */
  seed: number;
};

export const DEFAULT_SORT: SortOrder = { kind: "new", seed: 0 };

export const SORT_LABELS: Record<SortKind, string> = {
  new: "新しい順",
  old: "古い順",
  random: "ランダム",
};

const isSortKind = (s: string | null): s is SortKind =>
  s === "new" || s === "old" || s === "random";

/** Read `?sort=&seed=`; anything unknown falls back to newest first. */
export const parseSort = (params: URLSearchParams): SortOrder => {
  const kind = params.get("sort");
  if (!isSortKind(kind)) return DEFAULT_SORT;
  const seed = Number.parseInt(params.get("seed") ?? "", 10);
  return {
    kind,
    seed: kind === "random" && Number.isSafeInteger(seed) ? seed >>> 0 : 0,
  };
};

/** Query pairs for a sort order; the default writes nothing. */
export const serializeSort = (sort: SortOrder): [string, string][] => {
  if (sort.kind === DEFAULT_SORT.kind) return [];
  if (sort.kind === "random") {
    return [
      ["sort", "random"],
      ["seed", String(sort.seed)],
    ];
  }
  return [["sort", sort.kind]];
};

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Indexed = { index: number; value: Pick<MediaInfo, "timestamp"> };

/**
 * Sort photos for display. Photos without a timestamp go last in both date
 * orders; ties keep the media.json order (by index). Returns a new array.
 */
export const sortMedia = <T extends Indexed>(
  items: readonly T[],
  sort: SortOrder,
): T[] => {
  const byIndex = [...items].sort((a, b) => a.index - b.index);
  if (sort.kind === "random") {
    // Fisher–Yates over the index order, so the result depends only on the
    // seed and the set of photos, not on the order they came in.
    const rand = mulberry32(sort.seed);
    for (let i = byIndex.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [byIndex[i], byIndex[j]] = [byIndex[j], byIndex[i]];
    }
    return byIndex;
  }
  const sign = sort.kind === "new" ? -1 : 1;
  return byIndex.sort((a, b) => {
    const ta = a.value.timestamp?.getTime();
    const tb = b.value.timestamp?.getTime();
    if (ta === undefined || tb === undefined) {
      return (ta === undefined ? 1 : 0) - (tb === undefined ? 1 : 0);
    }
    return sign * (ta - tb);
  });
};
