import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { legacyIndex } from "~/components/gallery/logic";
import { topOgp, ogpHead, type Ogp } from "~/components/ogp";
import { useGalleryIndex } from "./layout";
import { legacyRedirect } from "./photo/[imageId]/legacy";

// The gallery reads the photo and tag filter from the URL itself.
export default component$(() => <Gallery />);

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useTopOgp));

/**
 * The card shows the newest photo. `/?imageId=N` is the oldest share format
 * (before /photo/N): it is sent on to the photo's page.
 */
export const useTopOgp = routeLoader$<Ogp>(async (event) => {
  const legacy = legacyIndex(event.query.get("imageId"));
  if (legacy !== null) {
    // Keep the rest (tag filter, sort) of the old share link.
    const query = new URLSearchParams(event.url.searchParams);
    query.delete("imageId");
    await legacyRedirect(event, legacy, query);
  }
  const { media } = await event.resolveValue(useGalleryIndex);
  return topOgp(
    {
      s3Base: import.meta.env.VITE_S3_BASE_URL,
      imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
    },
    media,
  );
});
