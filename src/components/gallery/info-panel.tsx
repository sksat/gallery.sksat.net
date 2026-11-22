import { component$, type QRL } from "@builder.io/qwik";

import type { PhotoInfo } from "./photo-info";
import {
  PhotoInfoList,
  PhotoTitle,
  TakenText,
  type TagLink,
} from "./photo-info-list";

export type { TagLink };

interface InfoPanelProps {
  info: PhotoInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /** Filter the gallery by a tag (and close the photo). */
  onTag$: QRL<(tag: string) => void>;
}

/**
 * A photo's metadata in the overlay, exactly as the API gave it, as one
 * row under the photo, each value once: when it was taken, the world or
 * place, the camera and its exposure, the tags and their fields, and the
 * file name. It wraps where the width runs out. On wide screens at the
 * bottom left, in the band under the photo (photo-overlay.tsx); on narrow
 * ones right under the photo. Never over it.
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
      aria-label="写真の情報"
      // A horizontal swipe on it steps like one on the photo.
      stoppropagation:click
      class={[
        // One translucent box.
        "flex overflow-y-auto overscroll-contain rounded-2xl bg-black/70 px-4 py-2.5 text-sm leading-snug text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md",
        // Narrow: right under the photo (--info-top); room under it for
        // the corner's buttons.
        "relative mx-auto mt-(--info-top) mb-20 w-fit max-w-[calc(100%-1.5rem)]",
        // Wide: at the bottom left, clear of the buttons; at most a few
        // lines, scrolling past them.
        "lg:mx-3 lg:mt-0 lg:mb-3 lg:max-h-[30dvh] lg:max-w-[min(100vw-11rem,80rem)] lg:justify-self-start",
      ]}
    >
      {/* Its values in a row that wraps. */}
      <dl class="flex flex-wrap items-center gap-x-5 gap-y-2 [&_dd]:break-words">
        {i.taken && (
          <div data-testid="info-taken" class="font-semibold tabular-nums">
            <dt class="sr-only">撮影日時</dt>
            <dd>
              <TakenText taken={i.taken} />
            </dd>
          </div>
        )}
        <PhotoTitle info={i} inline />
        <PhotoInfoList
          info={i}
          tagLinks={props.tagLinks}
          onTag$={props.onTag$}
          inline
        />
      </dl>
    </section>
  );
});
