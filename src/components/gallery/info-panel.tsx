import { component$, type QRL } from "@builder.io/qwik";

import type { WideInfoPlace } from "./overlay-layout";
import type { PhotoInfo } from "./photo-info";
import {
  ExposureSpecs,
  PhotoInfoList,
  PhotoTitle,
  type TagLink,
} from "./photo-info-list";

export type { TagLink };

interface InfoPanelProps {
  info: PhotoInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /** Filter the gallery by a tag (and close the photo). */
  onTag$: QRL<(tag: string) => void>;
  /**
   * When it shows (photo-overlay.tsx): classes, as it may depend on the
   * screen's width before the viewer has chosen.
   */
  visibility: string;
  /** Where it goes on wide screens (overlay-layout.ts). */
  wide: WideInfoPlace;
  /** Close it to the summary (its × on wide screens). */
  onClose$: QRL<() => void>;
}

/**
 * The details of a photo's metadata in the overlay, exactly as the API
 * gave it, in the room the photo leaves, never over it (the date is above
 * the photo, in photo-overlay.tsx): on narrow screens under the photo
 * (the overlay scrolls to it; its first line shows at the foot of the
 * first screen); on wide ones a translucent sheet beside the photo, or
 * under it with its parts side by side. The world or place first, the
 * exposure on one line, then the other rows, as on the photo page.
 *
 * Rendered on the server so the metadata is in the page without JS. It
 * takes its own clicks, so the overlay's "click outside closes" never
 * sees them.
 */
export const InfoPanel = component$<InfoPanelProps>((props) => {
  const i = props.info;
  const strip = props.wide === "below";
  return (
    <section
      id="photo-info"
      data-testid="info-panel"
      data-wide={props.wide}
      // A horizontal swipe on it steps like one on the photo (its scrolling
      // is vertical).
      aria-labelledby="photo-info-title"
      // Takes the focus when opened from the summary.
      tabIndex={-1}
      stoppropagation:click
      class={[
        props.visibility,
        "flex-col gap-4 text-white focus:outline-none",
        // Narrow: right under the photo (photo-overlay.tsx sets
        // --info-top), as wide as reads well; the foot leaves room for the
        // buttons in the corner.
        "relative mx-auto mt-(--info-top) w-full max-w-xl px-5 pt-4 pb-20",
        // Wide: a translucent sheet, scrolling on its own.
        "lg:absolute lg:m-0 lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:bg-black/75 lg:p-5 lg:pr-12 lg:text-sm lg:shadow-2xl lg:ring-1 lg:ring-white/10 lg:backdrop-blur-md",
        strip
          ? // Under the photo, centred, clear of the corner's buttons.
            "lg:bottom-3 lg:left-1/2 lg:max-h-(--strip) lg:w-[min(100vw-20rem,64rem)] lg:-translate-x-1/2 lg:flex-row lg:flex-wrap lg:content-start lg:items-start lg:justify-center lg:gap-x-10 lg:gap-y-3"
          : // In the margin at the right, just past the photo's edge
            // (photo-overlay.tsx sets --photo-half-w).
            "lg:top-1/2 lg:left-[calc(50%+var(--photo-half-w)+2rem)] lg:max-h-[calc(100vh-10rem)] lg:w-80 lg:-translate-y-1/2",
      ]}
    >
      <button
        type="button"
        data-testid="info-close"
        aria-label="閉じる"
        title="閉じる (i)"
        onClick$={props.onClose$}
        class="absolute top-3 right-3 hidden rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white lg:block"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      <PhotoTitle info={i} headingId="photo-info-title" />
      {i.exposure && <ExposureSpecs specs={i.exposure} />}
      <PhotoInfoList
        info={i}
        tagLinks={props.tagLinks}
        onTag$={props.onTag$}
        inline={strip}
      />
    </section>
  );
});
