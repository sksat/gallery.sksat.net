// Keyboard and swipe input for going through photos on the edit page and
// in its full-screen viewer: ←/→ step through the list the page was
// opened from, and in the viewer 1/2/3 set the visibility.

import type { Visibility } from "./types";

/** Visibility for the number keys, in the order the buttons show them. */
export const VISIBILITY_KEYS: readonly (readonly [string, Visibility])[] = [
  ["1", "private"],
  ["2", "unlisted"],
  ["3", "public"],
];

export type ReviewAction =
  | { type: "prev" }
  | { type: "next" }
  | { type: "visibility"; visibility: Visibility };

/** What reviewKey needs of a KeyboardEvent (and its target). */
export type KeyInput = {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The focused element's tag name (upper case), if any. */
  targetTag?: string;
  /** An <input>'s type. */
  targetType?: string;
  targetEditable?: boolean;
};

const TYPING_TAGS = new Set(["TEXTAREA", "SELECT"]);
/** Inputs that do not take typing (or arrow keys) themselves. */
const NON_TYPING_INPUTS = new Set(["checkbox", "button", "submit", "reset"]);

const isTyping = (e: KeyInput): boolean =>
  !!e.targetEditable ||
  (!!e.targetTag && TYPING_TAGS.has(e.targetTag)) ||
  (e.targetTag === "INPUT" &&
    !NON_TYPING_INPUTS.has((e.targetType ?? "text").toLowerCase()));

/**
 * The action for a key press, or null to leave the key alone: while typing
 * in a field (radio buttons included, which take the arrows; a checkbox
 * does not) or composing with an IME, with Alt/Ctrl/Meta (browser and
 * system shortcuts), and number keys held down (auto-repeat). The number
 * keys only act in the viewer.
 */
export const reviewKey = (
  e: KeyInput,
  inViewer: boolean,
): ReviewAction | null => {
  if (e.isComposing || e.key === "Process") return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (isTyping(e)) return null;
  if (e.key === "ArrowLeft") return { type: "prev" };
  if (e.key === "ArrowRight") return { type: "next" };
  if (!inViewer || e.repeat) return null;
  const match = VISIBILITY_KEYS.find(([k]) => k === e.key);
  return match ? { type: "visibility", visibility: match[1] } : null;
};

// Swipes (used by the viewer and the edit page's photo) are shared with
// the public gallery's overlay: the same rule as before, at least
// SWIPE_MIN px and mostly horizontal.
export { SWIPE_MIN, canStartSwipe, swipe } from "@shared/gestures/swipe";

/** The edit page URL with the full-screen viewer open (`fs=1`). */
export const withViewer = (href: string): string => {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("fs", "1");
  return `${path}?${params}`;
};

/** The same URL without the viewer flag. */
export const withoutViewer = (href: string): string => {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("fs");
  const s = params.toString();
  return s ? `${path}?${s}` : path;
};
