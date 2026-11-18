import type { MediaIndex, MediaInfo } from "./types";

/** How multiple selected tags combine. */
export type TagMatchMode = "and" | "or";

export type TagFilter = {
  tags: string[];
  mode: TagMatchMode;
};

export const DEFAULT_TAG_MODE: TagMatchMode = "and";

/**
 * Tags of a photo, with `platform` treated as just another tag.
 * The data keeps `platform` as a separate field (and VRChat entries also
 * carry a "VRChat" tag), so merge and de-duplicate here instead of in the
 * data.
 */
export const mediaTags = (m: MediaInfo): string[] => [
  ...new Set([m.platform, ...m.tags]),
];

/**
 * Every tag with the number of photos carrying it; most frequent first, ties
 * in Japanese locale order. Tags are case-sensitive ("film" ≠ "Film").
 */
export const tagCounts = (
  media: MediaIndex,
): { tag: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const m of media) {
    for (const tag of mediaTags(m)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
};

/**
 * Filter by selected tags, keeping original indices (used as photo IDs).
 * No selection means no filtering.
 */
export const filterMediaByTags = (
  media: MediaIndex,
  { tags: selected, mode }: TagFilter,
): { index: number; value: MediaInfo }[] => {
  const entries = media.map((value, index) => ({ index, value }));
  if (selected.length === 0) return entries;
  return entries.filter(({ value }) => {
    const tags = new Set(mediaTags(value));
    return mode === "and"
      ? selected.every((t) => tags.has(t))
      : selected.some((t) => tags.has(t));
  });
};

/** Read `?tag=a&tag=b&mode=or` into a filter. Unknown modes fall back to AND. */
export const parseTagFilter = (params: URLSearchParams): TagFilter => {
  const tags = [...new Set(params.getAll("tag").filter((t) => t !== ""))];
  const mode = params.get("mode");
  return {
    tags,
    mode: mode === "and" || mode === "or" ? mode : DEFAULT_TAG_MODE,
  };
};

/**
 * Inverse of parseTagFilter, returned without a leading "?". Defaults are
 * omitted so the unfiltered page keeps a bare URL; `mode` is only written
 * when it changes the result.
 */
export const serializeTagFilter = (filter: TagFilter): string => {
  const params = new URLSearchParams();
  for (const tag of new Set(filter.tags)) params.append("tag", tag);
  if (filter.tags.length > 0 && filter.mode !== DEFAULT_TAG_MODE) {
    params.set("mode", filter.mode);
  }
  return params.toString();
};

export const toggleTag = (selected: string[], tag: string): string[] =>
  selected.includes(tag)
    ? selected.filter((t) => t !== tag)
    : [...selected, tag];
