import {
  useSignal,
  useVisibleTask$,
  type QRL,
  type ReadonlySignal,
  type Signal,
} from "@builder.io/qwik";

import {
  canStartSwipe,
  dragOffset,
  lockAxis,
  swipeOrFlick,
  type SwipeDirection,
} from "@shared/gestures/swipe";

/** How the photo snaps back when a drag is not a swipe. */
const SNAP = "transform 200ms ease-out";

/**
 * How long after a horizontal drag a click is taken as left behind by it.
 * (A drag past FLICK_MIN is past the browser's tap slop, so it rarely
 * clicks at all; this is the safety net.)
 */
export const SWIPE_CLICK_MS = 500;

type SwipeOptions = {
  /** Where swipes start (touches inside `[data-no-swipe]` are left alone). */
  area: Signal<HTMLElement | undefined>;
  /** What follows the finger (the photo). */
  follow: Signal<HTMLElement | undefined>;
  /** Whether there is a photo before / after: the drag resists if not. */
  neighbors: ReadonlySignal<{ prev: boolean; next: boolean }>;
  /** Step to the previous or next photo; undefined: no swiping. */
  onStep$: QRL<(direction: SwipeDirection) => void> | undefined;
};

/**
 * Horizontal swipes between photos (shared/gestures/swipe.ts): the photo
 * follows a horizontal drag and steps on a long or fast enough one, else
 * snaps back. Vertical scrolls, pinch-zoom and a zoomed-in page stay the
 * browser's. Returns when the last horizontal drag ended (event time), so
 * a click it may leave behind can be told from a tap.
 */
export const useSwipe = (opts: SwipeOptions) => {
  const swipedAt = useSignal<number | null>(null);

  // A visible task is intended: the touch listeners are plain passive DOM
  // listeners on the area, added once it is on screen. Qwik's own would
  // put a non-passive touchmove listener on the whole document (scrolling
  // then waits on the main thread), and run late while their code loads.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = opts.area.value;
    const onStep$ = opts.onStep$;
    if (!el || !onStep$) return;

    // Vertical scrolls and pinch-zoom stay the browser's and horizontal
    // moves are swipes; while zoomed in, every move is the browser's (it
    // pans the photo), so no touch-action then.
    const vv = window.visualViewport;
    const setTouchAction = () => {
      el.style.touchAction = (vv?.scale ?? 1) > 1.01 ? "" : "pan-y pinch-zoom";
    };
    setTouchAction();
    vv?.addEventListener("resize", setTouchAction);

    let drag: {
      x: number;
      y: number;
      t: number;
      axis: "x" | "y" | null;
    } | null = null;
    const move = (dx: number, animate: boolean) => {
      const b = opts.follow.value;
      if (!b) return;
      b.style.transition = animate ? SNAP : "none";
      b.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
    };
    const end = () => {
      if (drag?.axis === "x") move(0, true);
      drag = null;
    };

    const onStart = (e: TouchEvent) => {
      // A second finger (a pinch) ends a drag.
      if (drag) return end();
      const t = e.touches[0] as Touch | undefined;
      const target = e.target as Element | null;
      if (
        !t ||
        // E.g. the info sheet and the share URL field keep their touches.
        target?.closest("[data-no-swipe]") ||
        !canStartSwipe({
          fingers: e.touches.length,
          x: t.clientX,
          width: window.innerWidth,
          scale: vv?.scale ?? 1,
        })
      ) {
        return;
      }
      drag = { x: t.clientX, y: t.clientY, t: e.timeStamp, axis: null };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag) return;
      const t = e.touches[0] as Touch | undefined;
      if (!t || e.touches.length > 1) return end();
      const dx = t.clientX - drag.x;
      const dy = t.clientY - drag.y;
      drag.axis ??= lockAxis(dx, dy);
      // A scroll: leave it to the browser.
      if (drag.axis === "y") return end();
      if (drag.axis === "x") {
        const can = opts.neighbors.value[dx < 0 ? "next" : "prev"];
        move(dragOffset(dx, can), false);
      }
    };

    const onEnd = (e: TouchEvent) => {
      const d = drag;
      const t = e.changedTouches[0] as Touch | undefined;
      if (!d || !t || d.axis !== "x") return end();
      swipedAt.value = e.timeStamp;
      const dir = swipeOrFlick(
        t.clientX - d.x,
        t.clientY - d.y,
        e.timeStamp - d.t,
      );
      if (dir && opts.neighbors.value[dir]) {
        // The photo is replaced by the next one; no snapping back.
        drag = null;
        onStep$(dir);
      } else {
        end();
      }
    };

    const passive = { passive: true };
    el.addEventListener("touchstart", onStart, passive);
    el.addEventListener("touchmove", onMove, passive);
    el.addEventListener("touchend", onEnd, passive);
    el.addEventListener("touchcancel", end, passive);
    cleanup(() => {
      vv?.removeEventListener("resize", setTouchAction);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", end);
    });
  });

  return swipedAt;
};
