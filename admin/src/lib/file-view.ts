// How the Files view shows a folder (pure; file-view.spec.ts): the order
// (名前 / 撮影日 / 追加日 / サイズ, either way) and grid or list, remembered
// per viewer in localStorage; moving the focus with the arrow keys; and
// where dragged items may be dropped.

import { isWithin } from "./folders";

export const SORT_KEYS = ["name", "taken", "added", "size"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type Layout = "grid" | "list";
export type ViewPrefs = { sort: SortKey; dir: SortDir; layout: Layout };

export const SORT_LABELS: Record<SortKey, string> = {
  name: "名前",
  taken: "撮影日",
  added: "追加日",
  size: "サイズ",
};

export const DEFAULT_PREFS: ViewPrefs = {
  sort: "name",
  dir: "asc",
  layout: "grid",
};

/** localStorage key of the viewer's choice. */
export const PREFS_KEY = "admin-files-view";

/** Stored prefs, read leniently (anything unknown is the default). */
export const parsePrefs = (raw: string | null | undefined): ViewPrefs => {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? "");
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof v !== "object" || v === null) return DEFAULT_PREFS;
  const o = v as Record<string, unknown>;
  return {
    sort: (SORT_KEYS as readonly unknown[]).includes(o.sort)
      ? (o.sort as SortKey)
      : DEFAULT_PREFS.sort,
    dir: o.dir === "desc" ? "desc" : "asc",
    layout: o.layout === "list" ? "list" : "grid",
  };
};

// Natural order, as file managers sort names: "img2" before "img10".
const collator = new Intl.Collator("ja", { numeric: true });
export const compareNames = (a: string, b: string): number =>
  collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

type SortablePhoto = {
  id: number;
  path: string;
  timestamp: string | null;
  size: number | null;
};

/**
 * Photos in the chosen order. Photos without the value (no date, no
 * recorded size) go last either way; ties keep name order.
 */
export const sortPhotos = <T extends SortablePhoto>(
  photos: readonly T[],
  prefs: Pick<ViewPrefs, "sort" | "dir">,
): T[] => {
  const sign = prefs.dir === "asc" ? 1 : -1;
  // Dates as instants: stored ones carry different offsets (Z, +09:00).
  const instant = (ts: string | null) => {
    const ms = ts ? Date.parse(ts) : NaN;
    return Number.isNaN(ms) ? null : ms;
  };
  const value = (p: T): number | null =>
    prefs.sort === "taken"
      ? instant(p.timestamp)
      : prefs.sort === "added"
        ? p.id
        : prefs.sort === "size"
          ? p.size
          : null;
  return [...photos].sort((a, b) => {
    if (prefs.sort !== "name") {
      const va = value(a);
      const vb = value(b);
      if (va === null && vb !== null) return 1;
      if (vb === null && va !== null) return -1;
      if (va !== null && vb !== null && va !== vb) {
        return (va < vb ? -1 : 1) * sign;
      }
      return compareNames(a.path, b.path);
    }
    return compareNames(a.path, b.path) * sign;
  });
};

/**
 * Folders (shown before the photos) in the chosen order: by name, or by
 * size; they have no date of their own, so date orders keep names.
 */
export const sortFolders = <T extends { name: string; bytes: number }>(
  folders: readonly T[],
  prefs: Pick<ViewPrefs, "sort" | "dir">,
): T[] => {
  const sign = prefs.dir === "asc" ? 1 : -1;
  return [...folders].sort((a, b) => {
    if (prefs.sort === "size" && a.bytes !== b.bytes) {
      return (a.bytes - b.bytes) * sign;
    }
    const byName = compareNames(a.name, b.name);
    return prefs.sort === "name" ? byName * sign : byName;
  });
};

/**
 * The item a key moves the focus to in a grid of `count` items laid out
 * `columns` wide (1 in the list), or null for keys that do not move it.
 * Down from the row above a short last row lands on the last item.
 */
export const moveFocus = (
  index: number,
  key: string,
  count: number,
  columns: number,
): number | null => {
  if (count === 0) return null;
  const cols = Math.max(1, columns);
  const last = count - 1;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(last, index + 1);
    case "ArrowUp":
      return index - cols >= 0 ? index - cols : index;
    case "ArrowDown":
      if (index + cols <= last) return index + cols;
      // Only when there is a row below.
      return Math.floor(last / cols) > Math.floor(index / cols) ? last : index;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
};

/**
 * Whether items dragged out of folder `from` (`folders` among them) can be
 * dropped into folder `dest`: not where they already are, and no folder
 * into itself or below itself.
 */
export const canDrop = (
  dest: string,
  from: string,
  folders: readonly string[],
): boolean => dest !== from && !folders.some((f) => isWithin(dest, f));
