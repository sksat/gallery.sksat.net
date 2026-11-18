/**
 * Horizontal swipes between photos, shared by the public gallery's overlay
 * and the admin's full-screen viewer: plain functions over touch
 * coordinates, so each app only wires them to its touch events.
 */

export type SwipeDirection = "prev" | "next";

/** Smallest horizontal travel (CSS px) that counts as a swipe. */
export const SWIPE_MIN = 50;

/** A shorter flick still counts when it is at least this fast (px/ms). */
export const FLICK_SPEED = 0.5;

/** Smallest travel for a flick (CSS px), so a tap never is one. */
export const FLICK_MIN = 20;

/** Travel (CSS px) after which a touch is taken as horizontal or not. */
export const AXIS_LOCK = 10;

/** Touches starting this close to a screen edge are the browser's own. */
export const EDGE = 24;

const direction = (dx: number): SwipeDirection => (dx < 0 ? "next" : "prev");

/** Mostly horizontal: well clear of a vertical scroll or a pinch. */
const horizontal = (dx: number, dy: number) =>
  Math.abs(dx) >= Math.abs(dy) * 1.5;

/**
 * A horizontal swipe from a touch's start to its end: to the left shows
 * the next photo, to the right the previous one. Mostly vertical moves
 * (scrolling, pinching) and short ones are not swipes.
 */
export const swipe = (dx: number, dy: number): SwipeDirection | null => {
  if (Math.abs(dx) < SWIPE_MIN || !horizontal(dx, dy)) return null;
  return direction(dx);
};

/**
 * `swipe`, plus a quick flick that is shorter than SWIPE_MIN but at least
 * FLICK_SPEED fast over `ms` milliseconds.
 */
export const swipeOrFlick = (
  dx: number,
  dy: number,
  ms: number,
): SwipeDirection | null => {
  const long = swipe(dx, dy);
  if (long) return long;
  if (
    Math.abs(dx) < FLICK_MIN ||
    !horizontal(dx, dy) ||
    ms <= 0 ||
    Math.abs(dx) / ms < FLICK_SPEED
  ) {
    return null;
  }
  return direction(dx);
};

/**
 * Whether a touch may start a swipe: one finger (two is a pinch), the page
 * not zoomed in (a drag then pans the photo), and not at the screen's edge
 * (the browser's own back and forward).
 */
export const canStartSwipe = (t: {
  fingers: number;
  x: number;
  width: number;
  /** window.visualViewport.scale (1 when not zoomed). */
  scale: number;
}): boolean =>
  t.fingers === 1 && t.scale <= 1.01 && t.x >= EDGE && t.x <= t.width - EDGE;

/**
 * Which way a moving touch goes, once it has travelled AXIS_LOCK: "x"
 * (follow it as a swipe) or "y" (a scroll: leave it alone); null before.
 */
export const lockAxis = (dx: number, dy: number): "x" | "y" | null => {
  if (Math.hypot(dx, dy) < AXIS_LOCK) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
};

/**
 * How far the photo follows the finger: all the way when there is a photo
 * that way, a third of it (resisting) when there is none.
 */
export const dragOffset = (dx: number, canGo: boolean): number =>
  canGo ? dx : dx / 3;
