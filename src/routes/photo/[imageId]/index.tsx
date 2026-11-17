import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { ogpHead, photoOgp, type Ogp } from "~/components/ogp";
import type { MediaInfoJSON } from "~/components/gallery/types";
import { parseImageId } from "./logic";

// The gallery reads the photo id (from the path) and tag filter itself.
export default component$(() => {
  return <Gallery />;
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(usePhotoOgp));

export const usePhotoOgp = routeLoader$<Ogp>(async (event) => {
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

  const media: MediaInfoJSON[] = await response.json();
  const ogp = photoOgp(
    {
      s3Base: import.meta.env.VITE_S3_BASE_URL,
      imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
    },
    media,
    imageId,
  );

  if (ogp === null) {
    throw event.error(404, "Image not found");
  }

  return ogp;
});
