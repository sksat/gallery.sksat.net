import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { parseImageId, getOgImageUrl } from "./logic";

// The gallery reads the photo id (from the path) and tag filter itself.
export default component$(() => {
  return <Gallery />;
});

export const head: DocumentHead = ({ resolveValue }) => {
  const imageUrl = resolveValue(useFetchImageUrl);

  return {
    title: "sksat gallery",
    meta: [
      {
        name: "description",
        content: "sksat gallery",
      },
      { property: "og:image", content: imageUrl },
    ],
  };
};

export const useFetchImageUrl = routeLoader$<string>(async (event) => {
  const imageId = parseImageId(event.params.imageId);

  if (imageId === null) {
    throw event.error(400, "Invalid image ID");
  }

  const response = await fetch(
    import.meta.env.VITE_S3_BASE_URL + "/media.json",
  );

  if (!response.ok) {
    throw event.error(500, "Failed to fetch media index");
  }

  const media = await response.json();
  const url = getOgImageUrl(import.meta.env.VITE_S3_BASE_URL, media, imageId);

  if (url === null) {
    throw event.error(404, "Image not found");
  }

  return url;
});
