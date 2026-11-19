import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";

import {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "@shared/overlay/progress";
import { overlayClass } from "@shared/overlay/styles";
import {
  canStartSwipe,
  dragOffset,
  lockAxis,
  swipeOrFlick,
  type SwipeDirection,
} from "@shared/gestures/swipe";
import { GRID_CANDIDATES, imageUrl, srcSet, type ImageSource } from "./images";
import { InfoPanel, type TagLink } from "./info-panel";
import { ShareButton } from "./share-button";
import type { MediaInfo } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

interface PhotoOverlayProps {
  /** A photo (by public id) or a camera picture (by bucket path). */
  src: ImageSource;
  onClose$: QRL<() => void>;
  /** Show the share button (default); off where the URL is not the photo's. */
  share?: boolean;
  /** The photo, for its info panel; none for a camera picture. */
  info?: MediaInfo;
  /** The info panel's tags with their gallery URLs. */
  tagLinks?: TagLink[];
  /** Filter the gallery by a tag from the info panel. */
  onTag$?: QRL<(tag: string) => void>;
  /** Step to the previous or next photo (a swipe); none: no swiping. */
  onStep$?: QRL<(direction: SwipeDirection) => void>;
  /** Whether there is a photo before / after this one. */
  neighbors?: { prev: boolean; next: boolean };
}

/** How the photo snaps back when a drag is not a swipe. */
const SNAP = "transform 200ms ease-out";

/**
 * How long after a horizontal drag a click is taken as left behind by it.
 * (A drag past FLICK_MIN is past the browser's tap slop, so it rarely
 * clicks at all; this is the safety net.)
 */
const SWIPE_CLICK_MS = 500;

/**
 * Full-screen view of one photo.
 *
 * The grid thumbnail (same srcset as the grid, so the browser reuses the
 * cached file) shows at once, scaled up. The full-size image is fetched in a
 * visible task so the download progress can be shown under the photo, then
 * stacked on top of the thumbnail as a blob: URL. A visible task (rather
 * than an <img> onLoad$) also runs when the overlay was server-rendered on
 * /photo/N, where a load event could fire before Qwik resumes.
 */
export const PhotoOverlay = component$<PhotoOverlayProps>((props) => {
  const fullSrc = useSignal<string>();
  // Fraction downloaded in [0, 1], null while the size is unknown, and
  // undefined once there is nothing to show (done or failed).
  const progress = useSignal<number | null | undefined>(0);

  // Swiping: the photo box follows a horizontal drag, then steps or snaps
  // back. When the last horizontal drag ended (event time), so the click
  // it may leave behind does not close the overlay.
  const backdrop = useSignal<HTMLElement>();
  const box = useSignal<HTMLElement>();
  const swipedAt = useSignal<number | null>(null);

  // A visible task is intended: the touch listeners are plain passive DOM
  // listeners on the overlay, added once it is on screen. Qwik's own would
  // put a non-passive touchmove listener on the whole document (scrolling
  // then waits on the main thread), and run late while their code loads.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = backdrop.value;
    if (!el || !props.onStep$) return;

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
    const moveBox = (dx: number, animate: boolean) => {
      const b = box.value;
      if (!b) return;
      b.style.transition = animate ? SNAP : "none";
      b.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
    };
    const end = () => {
      if (drag?.axis === "x") moveBox(0, true);
      drag = null;
    };

    const onStart = (e: TouchEvent) => {
      // A second finger (a pinch) ends a drag.
      if (drag) return end();
      const t = e.touches[0] as Touch | undefined;
      const target = e.target as Element | null;
      if (
        !t ||
        // The info sheet and the share URL field keep their own touches.
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
        const can = props.neighbors?.[dx < 0 ? "next" : "prev"] ?? false;
        moveBox(dragOffset(dx, can), false);
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
      if (dir && props.neighbors?.[dir] && props.onStep$) {
        // The next photo's overlay replaces this one (keyed by photo).
        drag = null;
        props.onStep$(dir);
      } else {
        end();
      }
    };

    const opts = { passive: true };
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd, opts);
    el.addEventListener("touchcancel", end, opts);
    cleanup(() => {
      vv?.removeEventListener("resize", setTouchAction);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", end);
    });
  });

  // A visible task is intended: the download must start when the overlay is
  // on screen, including when it was server-rendered. The task only starts
  // an async fetch, so it does not block the main thread.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const src = track(() => props.src);
    fullSrc.value = undefined;
    progress.value = 0;

    const preset = pickOverlayPreset(
      window.innerWidth * OVERLAY_BOX_WIDTH_RATIO,
      window.devicePixelRatio || 1,
    );
    const url = imageUrl(S3_BASE, src, IMAGE_BASE, preset);
    const controller = new AbortController();
    let objectUrl: string | undefined;

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return readWithProgress(response, (f) => {
          progress.value = f;
        });
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        fullSrc.value = objectUrl;
        progress.value = undefined;
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Let the browser load it directly (e.g. a cross-origin original
        // without CORS in development); no progress then.
        fullSrc.value = url;
        progress.value = undefined;
      });

    cleanup(() => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  });

  const percent = progressPercent(progress.value);

  // The look (shared/overlay/styles.ts) is shared with the admin's
  // full-screen preview.
  return (
    <div
      data-testid="overlay"
      ref={backdrop}
      onClick$={(e: MouseEvent) => {
        // The click a horizontal drag may leave behind is not a tap
        // outside (a later click is).
        const at = swipedAt.value;
        if (at !== null && e.timeStamp - at < SWIPE_CLICK_MS) return;
        props.onClose$();
      }}
      class={overlayClass.backdrop}
    >
      <div ref={box} data-testid="overlay-box" class={overlayClass.box}>
        <img
          aria-hidden="true"
          src={imageUrl(S3_BASE, props.src, IMAGE_BASE, "h240")}
          srcset={srcSet(S3_BASE, props.src, IMAGE_BASE, GRID_CANDIDATES)}
          class={overlayClass.image}
        />
        {fullSrc.value && (
          <img
            data-testid="overlay-image"
            src={fullSrc.value}
            class={overlayClass.image}
          />
        )}
      </div>
      <div
        data-testid="overlay-progress"
        role="progressbar"
        aria-label="写真を読み込み中"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        class={[
          overlayClass.progress,
          progress.value === undefined
            ? overlayClass.progressDone
            : overlayClass.progressActive,
        ]}
      >
        <div
          class={[
            overlayClass.progressFill,
            percent === undefined
              ? overlayClass.progressIndeterminate
              : overlayClass.progressDeterminate,
          ]}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      {props.share !== false && <ShareButton />}
      {props.info && props.onTag$ && (
        <InfoPanel
          photo={props.info}
          tagLinks={props.tagLinks ?? []}
          onTag$={props.onTag$}
        />
      )}
    </div>
  );
});
