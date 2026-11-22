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
 * The photo's metadata in the overlay, exactly as the API gave it: a
 * column beside the photo on wide screens, and under it on narrow ones
 * (the overlay scrolls), headed by the date. Shown until the viewer hides
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
        // Narrow: under the photo, as wide as reads well; the foot leaves
        // room for the buttons in the corner.
        "mx-auto mb-auto w-full max-w-xl shrink-0 px-5 pt-5 pb-20 text-white",
        // Wide: a column at the right edge, scrolling on its own.
        "lg:m-0 lg:h-full lg:w-[22rem] lg:max-w-none lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-white/10 lg:bg-black/80 lg:px-6 lg:pt-7 lg:pb-8",
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
