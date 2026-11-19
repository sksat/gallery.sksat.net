import {
  $,
  component$,
  sync$,
  useComputed$,
  useSignal,
  type QRL,
} from "@builder.io/qwik";

import { overlayClass } from "@shared/overlay/styles";
import type { SwipeDirection } from "@shared/gestures/swipe";
import type { ImageSource } from "./images";
import { InfoPanel, type TagLink } from "./info-panel";
import { ProgressiveImage } from "./progressive-image";
import { ShareButton } from "./share-button";
import type { MediaInfo } from "./types";
import { SWIPE_CLICK_MS, useSwipe } from "./use-swipe";

interface PhotoOverlayProps {
  /** A photo (by public id) or a camera picture (by bucket path). */
  src: ImageSource;
  onClose$: QRL<() => void>;
  /**
   * The photo, for its info panel, share button and page link; none for
   * a camera picture.
   */
  info?: MediaInfo;
  /** The photo's own page (/photo/<id>/ with the list it is in). */
  detailHref?: string;
  /** Open that page (a plain click on its button); none: follow the link. */
  onDetail$?: QRL<() => void>;
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
 * Full-screen view of one photo, over the list: the quick viewer. Its own
 * page (/photo/<id>/) is one tap away with the page button.
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
      <ProgressiveImage
        src={props.src}
        boxRef={box}
        boxClass={overlayClass.box}
      />
      {props.info && <ShareButton photoId={props.info.id} />}
      {props.detailHref && (
        // Plain <a>: see the note in components/layout/header.tsx.
        <a
          href={props.detailHref}
          data-testid="detail-link"
          aria-label="写真のページを開く"
          title="写真のページ (Enter)"
          stoppropagation:click
          // A plain click goes through `onDetail$`; one that opens a new
          // tab or window keeps the browser's own behaviour.
          onClick$={
            props.onDetail$ && [
              sync$((e: MouseEvent) => {
                if (
                  e.button === 0 &&
                  !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                )
                  e.preventDefault();
              }),
              $((e: MouseEvent) => {
                if (e.defaultPrevented) props.onDetail$?.();
              }),
            ]
          }
          // `!`: the site's unlayered `a { color }` would win otherwise;
          // this is a button like its neighbours, not a text link. Above
          // the open info sheet, like the ⓘ and share buttons.
          class="absolute right-[6.5rem] bottom-3 z-20 rounded-full bg-black/50 p-2 !text-white/80 hover:bg-black/70 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
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
