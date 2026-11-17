import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import type { MediaInfoJSON } from "~/components/gallery/types";
import { fallbackOgp, ogpHead, topOgp, type Ogp } from "~/components/ogp";

// The gallery reads the photo and tag filter from the URL itself.
export default component$(() => <Gallery />);

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useTopOgp));

/** The card shows the newest photo; without media.json, a text-only card. */
export const useTopOgp = routeLoader$<Ogp>(async () => {
  try {
    const response = await fetch(
      import.meta.env.VITE_S3_BASE_URL + "/media.json",
    );
    if (!response.ok) return fallbackOgp("/");
    const media: MediaInfoJSON[] = await response.json();
    return topOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      media,
    );
  } catch {
    return fallbackOgp("/");
  }
});
