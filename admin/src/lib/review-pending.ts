// Staged visibility decisions in the full-screen viewer (like a culling
// tool's flags): 1/2/3 mark a photo's new visibility as pending; nothing is
// saved until 反映 applies them all at once.

import { VISIBILITIES, isVisibility, type Visibility } from "./types";

export type PendingItem = {
  /** The new visibility. */
  to: Visibility;
  /** The saved one when it was marked (to show and to undo). */
  from: Visibility;
  /** For the confirm step's thumbnails. */
  file: string;
};

/** Pending choices by photo id. */
export type Pending = Record<number, PendingItem>;

/**
 * Mark (or unmark) `choice` for a photo: choosing its saved visibility, or
 * the choice already pending, clears the mark.
 */
export const togglePending = (
  pending: Pending,
  id: number,
  choice: Visibility,
  saved: Visibility,
  file: string,
): Pending => {
  const next = { ...pending };
  if (choice === saved || pending[id]?.to === choice) delete next[id];
  else next[id] = { to: choice, from: saved, file };
  return next;
};

/** How many photos go to each visibility. */
export const pendingCounts = (pending: Pending): Record<Visibility, number> => {
  const counts = { private: 0, unlisted: 0, public: 0 };
  for (const item of Object.values(pending)) counts[item.to]++;
  return counts;
};

/**
 * The photos that would become visible to others (public or unlisted):
 * these need a look before applying; making photos private does not.
 */
export const exposing = (pending: Pending): [number, PendingItem][] =>
  Object.entries(pending)
    .map(([id, item]) => [Number(id), item] as [number, PendingItem])
    .filter(([, item]) => item.to !== "private");

/**
 * The bulk updates for the pending choices: ids grouped by their new
 * visibility, at most `max` ids per update.
 */
export const pendingBatches = (
  pending: Pending,
  max: number,
): { visibility: Visibility; ids: number[] }[] => {
  const batches: { visibility: Visibility; ids: number[] }[] = [];
  for (const visibility of VISIBILITIES) {
    const ids = Object.entries(pending)
      .filter(([, item]) => item.to === visibility)
      .map(([id]) => Number(id))
      .sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += max) {
      batches.push({ visibility, ids: ids.slice(i, i + max) });
    }
  }
  return batches;
};

/**
 * sessionStorage key for the pending choices of one list: its URL without
 * the page, so stepping across a page boundary keeps them.
 */
export const pendingKey = (listHref: string): string => {
  const [path, query = ""] = listHref.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("page");
  const s = params.toString();
  return `admin-review-pending:${s ? `${path}?${s}` : path}`;
};

/** Pending choices from storage; anything malformed is dropped. */
export const parsePending = (raw: string | null): Pending => {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  const out: Pending = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const id = Number(key);
    const v = value as Partial<PendingItem> | null;
    if (
      Number.isSafeInteger(id) &&
      id > 0 &&
      v &&
      isVisibility(v.to) &&
      isVisibility(v.from) &&
      typeof v.file === "string"
    ) {
      out[id] = { to: v.to, from: v.from, file: v.file };
    }
  }
  return out;
};
