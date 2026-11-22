import { component$, type QRL } from "@builder.io/qwik";

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
}

/**
 * The photo's metadata in the overlay, exactly as the API gave it, never
 * moving the photo from the centre: a card at the top right on wide
 * screens (over the photo only where a wide photo reaches it), and under
 * the photo on narrow ones (the overlay scrolls to it; its title shows at
 * the foot of the first screen). The same parts as the photo page: the
 * date as the title with the world or place, the exposure readout, then
 * the other rows. Shown until the viewer hides it (the ⓘ button or `i`,
 * in photo-overlay.tsx).
 *
 * Rendered on the server so the metadata is in the page without JS. It
 * takes its own clicks, so the overlay's "click outside closes" never
 * sees them.
 */
export const InfoPanel = component$<InfoPanelProps>((props) => {
  const i = props.info;
  return (
    <section
      id="photo-info"
      data-testid="info-panel"
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
        // Wide: a dark card at the top right, over the photo where the
        // photo reaches it (dark enough for its links over a bright
        // photo), scrolling on its own.
        "lg:absolute lg:top-4 lg:right-4 lg:m-0 lg:max-h-[calc(100%-6rem)] lg:w-[22rem] lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:bg-[#0c0f22]/90 lg:p-6 lg:shadow-2xl lg:ring-1 lg:ring-white/10 lg:backdrop-blur-md",
      ]}
    >
      <PhotoTitle info={i} level={2} id="photo-info-title" />
      {i.exposure && <ExposureSpecs specs={i.exposure} />}
      <PhotoInfoList info={i} tagLinks={props.tagLinks} onTag$={props.onTag$} />
    </section>
  );
});
