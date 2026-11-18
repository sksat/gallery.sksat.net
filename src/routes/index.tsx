import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { topOgp, ogpHead, type Ogp } from "~/components/ogp";
import { useGalleryIndex } from "./layout";

// The gallery reads the photo and tag filter from the URL itself.
export default component$(() => <Gallery />);

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useTopOgp));

/** The card shows the newest photo. */
export const useTopOgp = routeLoader$<Ogp>(async (event) => {
  const { media } = await event.resolveValue(useGalleryIndex);
  return topOgp(
    {
      s3Base: import.meta.env.VITE_S3_BASE_URL,
      imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
    },
    media,
  );
});
