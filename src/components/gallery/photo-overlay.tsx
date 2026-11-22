import {
  $,
  component$,
  useComputed$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";
import { isBrowser } from "@builder.io/qwik/build";

import { overlayClass } from "@shared/overlay/styles";
import type { SwipeDirection } from "@shared/gestures/swipe";
import { photoSize, type ImageSource } from "./images";
import { InfoPanel, type TagLink } from "./info-panel";
import { isTextTarget } from "./keys";
import {
  hasDetails,
  INFO_HIDDEN,
  INFO_SHOWN_KEY,
  infoShownFrom,
  photoInfo,
} from "./photo-info";
import { ProgressiveImage } from "./progressive-image";
import { ShareButton } from "./share-button";
import type { MediaInfo } from "./types";
import { SWIPE_CLICK_MS, useSwipe } from "./use-swipe";

/** The viewer's stored choice; shown where storage is unavailable. */
const storedInfoShown = (): boolean => {
  try {
    return infoShownFrom(localStorage.getItem(INFO_SHOWN_KEY));
  } catch {
    return true;
  }
};

const storeInfoShown = (shown: boolean) => {
  try {
    if (shown) localStorage.removeItem(INFO_SHOWN_KEY);
    else localStorage.setItem(INFO_SHOWN_KEY, INFO_HIDDEN);
  } catch {
    // Not kept: the next photo shows its info again.
  }
};

const ROUND =
  "rounded-full p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
// `!` on the colour: the site's unlayered `a { color }` would win otherwise.
const ROUND_BUTTON = `${ROUND} bg-black/50 !text-white/80 hover:bg-black/70 hover:!text-white`;
/** A toggle while it is on. */
const ROUND_BUTTON_ON = `${ROUND} bg-white/90 text-black hover:bg-white`;

interface PhotoOverlayProps {
  /** A photo (by public id) or a camera picture (by bucket path). */
  src: ImageSource;
  onClose$: QRL<() => void>;
  /**
   * The photo, for its info panel, share button and page link; none for
   * a camera picture.
   */
  info?: MediaInfo;
  /** The photo's detail page (/photo/<id>/detail/ with the list it is in). */
  detailHref?: string;
  /** The info panel's tags with their gallery URLs. */
  tagLinks?: TagLink[];
  /** Filter the gallery by a tag from the info panel. */
  onTag$?: QRL<(tag: string) => void>;
  /** Step to the previous or next photo (a swipe); none: no swiping. */
  onStep$?: QRL<(direction: SwipeDirection) => void>;
  /** Whether there is a photo before / after this one. */
  neighbors?: { prev: boolean; next: boolean };
}

/**
 * Full-screen view of one photo, over the list: the quick viewer, at the
 * photo's URL (/photo/<id>/). Its metadata is shown beside the photo on
 * wide screens and under it on narrow ones, until the viewer hides it
 * (remembered); its detail page (/photo/<id>/detail/) is one tap away
 * with the page button.
 */
export const PhotoOverlay = component$<PhotoOverlayProps>((props) => {
  const backdrop = useSignal<HTMLElement>();
  const box = useSignal<HTMLElement>();
  const toggle = useSignal<HTMLButtonElement>();
  const neighbors = useComputed$(
    () => props.neighbors ?? { prev: false, next: false },
  );
  const swipedAt = useSwipe({
    area: backdrop,
    follow: box,
    neighbors,
    onStep$: props.onStep$,
  });

  // Rendered shown on the server; in the browser (stepping to the next
  // photo makes a new overlay) the stored choice from the start.
  const shown = useSignal(isBrowser ? storedInfoShown() : true);
  // A visible task is intended: the stored choice is only known in the
  // browser, and a server-rendered overlay has to follow it.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    shown.value = storedInfoShown();
  });

  const info = useComputed$(() =>
    props.info ? photoInfo(props.info) : undefined,
  );
  const i = info.value;
  const hasInfo =
    i !== undefined &&
    props.onTag$ !== undefined &&
    (hasDetails(i) || i.tags.length > 0);
  const open = hasInfo && shown.value;

  const setShown = $((value: boolean) => {
    // Hiding (by `i`) with the focus inside: hand it to the ⓘ button
    // rather than lose it with the panel.
    const panel = document.getElementById("photo-info");
    if (!value && panel?.contains(document.activeElement)) {
      toggle.value?.focus();
    }
    shown.value = value;
    storeInfoShown(value);
  });

  const onKeyDown = $((event: KeyboardEvent) => {
    if (
      event.key !== "i" ||
      event.repeat ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    if (isTextTarget(event.target)) return;
    setShown(!shown.value);
  });

  // The photo's shape, so that under the photo the info starts where the
  // photo ends (3:2 until its size is known).
  const size = props.info ? photoSize(props.info) : {};
  const aspect = "width" in size ? `${size.width} / ${size.height}` : "3 / 2";

  // The look of the backdrop, photo and progress bar (shared/overlay) is
  // shared with the admin's full-screen preview.
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
      {/* Narrow: the photo, then its info, centred together when they fit
          and scrolling when not. Wide: side by side. */}
      <div class="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain lg:flex-row lg:overflow-hidden">
        <div
          class={[
            "flex shrink-0 flex-col items-center justify-center gap-3",
            open
              ? "mt-auto pt-3 lg:mt-0 lg:h-full lg:min-w-0 lg:flex-1 lg:shrink lg:pt-0"
              : "min-h-full w-full",
          ]}
        >
          <ProgressiveImage
            src={props.src}
            boxRef={box}
            boxClass={
              open
                ? // Narrow: the screen's width, leaving the info's first
                  // lines in view. Wide: the room beside the info.
                  "relative w-full max-h-[calc(100dvh-10rem)] lg:h-[85vh] lg:max-h-none lg:w-[calc(100%-3rem)]"
                : overlayClass.box
            }
            boxStyle={open ? { aspectRatio: aspect } : undefined}
          />
        </div>
        {hasInfo && (
          <InfoPanel
            info={i}
            shown={open}
            tagLinks={props.tagLinks ?? []}
            onTag$={props.onTag$!}
          />
        )}
      </div>

      {/* The photo's buttons, at the bottom right of the photo's side.
          Only the buttons take clicks (and keep them from the overlay,
          which closes on click); the rest of the corner still closes it. */}
      <div
        class={[
          "pointer-events-none absolute right-3 bottom-3 z-20 flex items-end gap-2 [&>*]:pointer-events-auto",
          open && "lg:right-[23.5rem]",
        ]}
      >
        {props.detailHref && (
          // Plain <a>: see the note in components/layout/header.tsx.
          <a
            href={props.detailHref}
            data-testid="detail-link"
            aria-label="写真のページを開く"
            title="写真のページ (Enter)"
            // Not a tap outside the photo (which closes the overlay).
            stoppropagation:click
            class={ROUND_BUTTON}
          >
            {/* A page with lines: the photo's own page. */}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8" />
              <path d="M8 12h8" />
              <path d="M8 16h5" />
            </svg>
          </a>
        )}
        {hasInfo && (
          <button
            ref={toggle}
            // It also carries the `i` key (on an element: see gallery.tsx
            // on why not useOnDocument).
            document:onKeyDown$={onKeyDown}
            type="button"
            data-testid="info-toggle"
            aria-label="情報"
            title="情報 (i)"
            aria-controls="photo-info"
            // A string: Qwik writes a boolean true as an empty attribute.
            aria-expanded={open ? "true" : "false"}
            stoppropagation:click
            onClick$={() => setShown(!shown.value)}
            class={open ? ROUND_BUTTON_ON : ROUND_BUTTON}
          >
            {/* ⓘ */}
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </button>
        )}
        {props.info && <ShareButton photoId={props.info.id} />}
      </div>
    </div>
  );
});
