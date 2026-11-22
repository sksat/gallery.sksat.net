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
  /** Shown (else hidden, the photo taking the whole screen). */
  shown: boolean;
  /** Where it goes on wide screens (overlay-layout.ts). */
  wide: WideInfoPlace;
}

/**
 * The photo's metadata in the overlay, exactly as the API gave it, in the
 * room the photo leaves, never over it (the date is above the photo, in
 * photo-overlay.tsx): on narrow screens under the photo (the overlay
 * scrolls to it; its first line shows at the foot of the first screen);
 * on wide ones beside the photo, or in a strip under it, its parts side by
 * side. The same parts as the photo page: the world or place, the
 * exposure readout, then the other rows. Shown until the viewer hides it
 * (the ⓘ button or `i`).
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
      stoppropagation:click
      class={[
        props.shown ? "flex" : "hidden",
        "flex-col gap-5 text-white",
        // Narrow: right under the photo (photo-overlay.tsx sets
        // --info-top), as wide as reads well; the foot leaves room for the
        // buttons in the corner.
        "relative mx-auto mt-(--info-top) w-full max-w-xl px-5 pt-4 pb-20",
        "lg:absolute lg:m-0 lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:p-0",
        strip
          ? // Under the photo, centred, clear of the corner's buttons.
            "lg:bottom-3 lg:left-1/2 lg:h-(--strip) lg:w-[min(100vw-20rem,64rem)] lg:-translate-x-1/2 lg:flex-row lg:flex-wrap lg:content-start lg:items-start lg:justify-center lg:gap-x-10 lg:gap-y-3"
          : // In the margin at the right, just past the photo's edge
            // (photo-overlay.tsx sets --photo-half-w).
            "lg:top-1/2 lg:left-[calc(50%+var(--photo-half-w)+2rem)] lg:max-h-[calc(100vh-10rem)] lg:w-80 lg:-translate-y-1/2",
      ]}
    >
      <PhotoTitle info={i} headingId="photo-info-title" />
      {i.exposure && <ExposureSpecs specs={i.exposure} row={strip} />}
      <PhotoInfoList
        info={i}
        tagLinks={props.tagLinks}
        onTag$={props.onTag$}
        inline={strip}
      />
    </section>
  );
});
