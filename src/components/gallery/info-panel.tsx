import { component$, type QRL } from "@builder.io/qwik";

import type { PhotoInfo } from "./photo-info";
import { PhotoInfoList, type TagLink } from "./photo-info-list";

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
 * The photo's metadata in the overlay, exactly as the API gave it, headed
 * by the date, never moving the photo from the centre: a translucent card
 * at the top right on wide screens (over the photo only where a wide
 * photo reaches it), and under the photo on narrow ones (the overlay
 * scrolls to it; its date shows at the foot of the first screen). Shown until the viewer hides
 * it (the ⓘ button or `i`, in photo-overlay.tsx).
 *
 * Rendered on the server so the metadata is in the page without JS. It
 * takes its own clicks, so the overlay's "click outside closes" never
 * sees them.
 */
export const InfoPanel = component$<InfoPanelProps>((props) => {
  const { taken, ...rest } = props.info;
  return (
    <section
      id="photo-info"
      data-testid="info-panel"
      // A horizontal swipe on it steps like one on the photo (its scrolling
      // is vertical).
      aria-labelledby="photo-info-title"
      stoppropagation:click
      class={[
        props.shown ? "" : "hidden",
        // Narrow: right under the photo (photo-overlay.tsx sets
        // --info-top), as wide as reads well; the foot leaves room for the
        // buttons in the corner.
        "relative mx-auto mt-(--info-top) w-full max-w-xl px-5 pt-3 pb-20 text-white",
        // Wide: a translucent card at the top right, over the photo
        // where the photo reaches it, scrolling on its own.
        "lg:absolute lg:top-4 lg:right-4 lg:m-0 lg:max-h-[calc(100%-6rem)] lg:w-[21rem] lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:bg-black/65 lg:px-6 lg:pt-6 lg:pb-6 lg:shadow-2xl lg:ring-1 lg:ring-white/10 lg:backdrop-blur-md",
      ]}
    >
      {/* The date heads it, as the photo's name would. `!`: the site's
          unlayered h2 rule would win otherwise. */}
      <h2
        id="photo-info-title"
        data-testid={taken ? "info-taken" : undefined}
        class={[
          "!mb-5 !text-xl leading-tight !font-semibold tabular-nums",
          taken ? "" : "sr-only",
        ]}
      >
        {taken ? <time dateTime={taken.datetime}>{taken.text}</time> : "情報"}
      </h2>
      <PhotoInfoList
        info={{ ...rest, taken: null }}
        tagLinks={props.tagLinks}
        onTag$={props.onTag$}
      />
    </section>
  );
});
