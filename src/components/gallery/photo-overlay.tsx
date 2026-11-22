import {
  component$,
  useComputed$,
  useSignal,
  type QRL,
} from "@builder.io/qwik";

import { overlayClass } from "@shared/overlay/styles";
import type { SwipeDirection } from "@shared/gestures/swipe";
import { photoSize, type ImageSource } from "./images";
import { InfoPanel, type TagLink } from "./info-panel";
import { hasDetails, photoInfo } from "./photo-info";
import { ProgressiveImage } from "./progressive-image";
import { ShareButton } from "./share-button";
import type { MediaInfo } from "./types";
import { SWIPE_CLICK_MS, useSwipe } from "./use-swipe";

// `!` on the colour: the site's unlayered `a { color }` would win otherwise.
const ROUND_BUTTON =
  "rounded-full p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white bg-black/50 !text-white/80 hover:bg-black/70 hover:!text-white";

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
 * photo's URL (/photo/<id>/). The photo stays centred and nothing covers
 * it. Its info is one row under the photo (at the bottom left on wide
 * screens), each value once, wrapping where it runs out of width. Its
 * detail page (/photo/<id>/detail/) is one tap away with the page button.
 */
export const PhotoOverlay = component$<PhotoOverlayProps>((props) => {
  const backdrop = useSignal<HTMLElement>();
  const box = useSignal<HTMLElement>();
  const neighbors = useComputed$(
    () => props.neighbors ?? { prev: false, next: false },
  );
  const swipedAt = useSwipe({
    area: backdrop,
    follow: box,
    neighbors,
    onStep$: props.onStep$,
  });

  const info = useComputed$(() =>
    props.info ? photoInfo(props.info) : undefined,
  );
  const i = info.value;
  const hasInfo =
    i !== undefined &&
    props.onTag$ !== undefined &&
    (hasDetails(i) || i.tags.length > 0);

  // Narrow screens: the photo stays centred on the first screen, at most
  // as tall as leaves a peek of the info at its foot, and the info starts
  // right under the photo (from its shape; at that most when its size is
  // not known, rather than a guessed shape).
  const size = props.info ? photoSize(props.info) : {};
  const most = "100dvh - 2 * var(--peek)";
  const layout = {
    "--peek": "5rem",
    "--photo-h":
      "width" in size
        ? `min(90vw * ${size.height / size.width}, ${most})`
        : `calc(${most})`,
    "--info-top": "calc(var(--photo-h) / 2 - 50dvh)",
  };

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
      {/* The photo centred, and its info never over it: one row that
          wraps. Narrow: right under the photo, the overlay scrolling to it.
          Wide: at the bottom left, in a band under the photo as tall as the
          row. */}
      <div
        style={layout}
        class={[
          "absolute inset-0 overflow-y-auto overscroll-contain lg:overflow-hidden",
          hasInfo && "lg:grid lg:grid-rows-[minmax(0,1fr)_auto]",
        ]}
      >
        <div
          class={[
            "flex h-dvh flex-col items-center justify-center gap-3",
            // Wide: the photo centred in the room above the info's band.
            hasInfo && "lg:h-auto lg:min-h-0 lg:pt-4 lg:pb-3",
          ]}
        >
          <ProgressiveImage
            src={props.src}
            boxRef={box}
            boxClass={
              hasInfo
                ? "relative flex h-(--photo-h) w-[90vw] items-center justify-center lg:h-auto lg:min-h-0 lg:flex-1"
                : overlayClass.box
            }
          />
        </div>
        {hasInfo && (
          <InfoPanel
            info={i}
            tagLinks={props.tagLinks ?? []}
            onTag$={props.onTag$!}
          />
        )}
      </div>

      {/* The photo's buttons, at the bottom right corner (beside the info,
          which leaves room for them). Only the buttons take clicks (and
          keep them from the overlay, which closes on click); the rest of
          the corner still closes it. */}
      <div class="pointer-events-none absolute right-3 bottom-3 z-20 flex items-end gap-2 [&>*]:pointer-events-auto">
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
            {/* ⓘ: the photo's page, with all of its info. */}
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
          </a>
        )}
        {props.info && <ShareButton photoId={props.info.id} />}
      </div>
    </div>
  );
});
