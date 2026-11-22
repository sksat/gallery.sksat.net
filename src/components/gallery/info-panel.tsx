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
  /** Shown (`flex`) or not (`hidden`). */
  visibility: string;
}

/**
 * The details of a photo's metadata in the overlay, exactly as the API
 * gave it, under their summary line in its block (photo-overlay.tsx),
 * never over the photo: the world or place, the exposure on one line, then
 * the other rows, as on the photo page; on wide screens side by side.
 *
 * Rendered on the server so the metadata is in the page without JS. Its
 * block takes its own clicks, so the overlay's "click outside closes"
 * never sees them.
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
      class={[
        props.visibility,
        "min-h-0 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-1 pb-4",
        // Wide: its parts side by side.
        "lg:flex-row lg:flex-wrap lg:content-start lg:items-start lg:gap-x-10 lg:gap-y-3",
      ]}
    >
      <PhotoTitle info={i} headingId="photo-info-title" />
      {i.exposure && <ExposureSpecs specs={i.exposure} />}
      <PhotoInfoList
        info={i}
        tagLinks={props.tagLinks}
        onTag$={props.onTag$}
        inline
      />
    </section>
  );
});
