// Multi-selection in the Files view, as in a desktop file manager (pure;
// selection.spec.ts). Items are keyed "f:<folder path>" or "p:<photo id>"
// in the order they are shown.

import type { Pending } from "./review-pending";
import type { Visibility } from "./types";

export type SelKey = `f:${string}` | `p:${number}`;

export const folderKey = (path: string): SelKey => `f:${path}`;
export const photoKey = (id: number): SelKey => `p:${id}`;

export type Selection = {
  /** Selected keys, in the order shown. */
  keys: SelKey[];
  /** Where a Shift range starts: the last item clicked without Shift. */
  anchor: SelKey | null;
};

export const EMPTY_SELECTION: Selection = { keys: [], anchor: null };

const inOrder = (order: readonly SelKey[], keys: Iterable<SelKey>) => {
  const set = new Set(keys);
  return order.filter((k) => set.has(k));
};

/**
 * A click on `key`. `range` (Shift): everything from the anchor to it, added
 * to the selection when `toggle` (Ctrl/Cmd) is also held, else replacing
 * it. Otherwise `toggle` flips that one item and makes it the anchor.
 * (A plain click is the caller's business: it opens the item, or toggles
 * once something is selected.)
 */
export const clickItem = (
  order: readonly SelKey[],
  sel: Selection,
  key: SelKey,
  mods: { range: boolean; toggle: boolean },
): Selection => {
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : null;
  if (mods.range && anchor) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(key);
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return {
      keys: inOrder(order, mods.toggle ? [...sel.keys, ...span] : span),
      anchor,
    };
  }
  const has = sel.keys.includes(key);
  return {
    // (Keys not shown, kept through a reload, go with any edit: what the
    // user changes is what they see.)
    keys: has
      ? inOrder(order, sel.keys).filter((k) => k !== key)
      : inOrder(order, [...sel.keys, key]),
    anchor: key,
  };
};

export const selectAll = (order: readonly SelKey[]): Selection => ({
  keys: [...order],
  anchor: order[0] ?? null,
});

/**
 * The selection after the shown items changed. Within the same view (the
 * same folder and filter) every key is kept, even one the new data lacks:
 * a reload can briefly miss an item, and it is selected again once it is
 * back. Another view starts from what it still shows. What actions and
 * the count use is `keepShown` of the result: only items really shown.
 */
export const reconcileSelection = (
  order: readonly SelKey[],
  sel: Selection,
  sameView: boolean,
): Selection => (sameView ? sel : keepShown(order, sel));

/** Keep only keys still shown (after a navigation or a reload). */
export const keepShown = (
  order: readonly SelKey[],
  sel: Selection,
): Selection => {
  const keys = inOrder(order, sel.keys);
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : null;
  return keys.length === sel.keys.length && anchor === sel.anchor
    ? sel
    : { keys, anchor };
};

/**
 * Setting the selected photos to `to`, as pending choices (review-pending):
 * the photos that change, with their old visibility. `exposing()` of it is
 * what needs a look before applying.
 */
export const visibilityPending = (
  photos: readonly { id: number; file: string; visibility: Visibility }[],
  to: Visibility,
): Pending =>
  Object.fromEntries(
    photos
      .filter((p) => p.visibility !== to)
      .map((p) => [p.id, { to, from: p.visibility, file: p.file }]),
  );

/** The visibility every photo has, or null when they differ (or none). */
export const sharedVisibility = (
  photos: readonly { visibility: Visibility }[],
): Visibility | null => {
  const set = new Set(photos.map((p) => p.visibility));
  return set.size === 1 ? [...set][0] : null;
};

/**
 * The camera every photo has (null: none of them has one), or undefined
 * when they differ (or there are none).
 */
export const sharedCamera = (
  photos: readonly { camera_id: number | null }[],
): number | null | undefined => {
  const set = new Set(photos.map((p) => p.camera_id));
  return set.size === 1 ? [...set][0] : undefined;
};

/** The platform every photo has, or undefined when they differ. */
export const sharedPlatform = <P extends string>(
  photos: readonly { platform: P }[],
): P | undefined => {
  const set = new Set(photos.map((p) => p.platform));
  return set.size === 1 ? [...set][0] : undefined;
};

/**
 * `items` in runs of at most `size`, in order: a selection larger than one
 * request may carry goes as several, one after another.
 */
export const inChunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

/** The selection split into photo ids and folder paths. */
export const splitSelection = (
  keys: readonly SelKey[],
): { photos: number[]; folders: string[] } => ({
  photos: keys.filter((k) => k.startsWith("p:")).map((k) => Number(k.slice(2))),
  folders: keys.filter((k) => k.startsWith("f:")).map((k) => k.slice(2)),
});
