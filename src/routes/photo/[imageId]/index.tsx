import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import { PhotoDetail } from "~/components/gallery/photo-detail";
import { PUBLIC_ID_RE, type MediaInfoJSON } from "~/components/gallery/types";
import { ogpHead, photoOgp, type Ogp } from "~/components/ogp";
import { loadPhoto, UNAVAILABLE } from "~/lib/api";
import { useGalleryIndex } from "../../layout";

type PhotoPage = {
  photo: MediaInfoJSON;
  ogp: Ogp;
  /** Not in the public list: an unlisted photo, kept out of search. */
  unlisted: boolean;
};

/**
 * The photo, from the API: public or unlisted (an unlisted photo opens by
 * its URL but is in no list), 404 for a private or unknown one. */
export const usePhotoPage = routeLoader$<PhotoPage>(async (event) => {
  const raw = event.params.imageId;
  if (!PUBLIC_ID_RE.test(raw)) {
    throw event.error(404, "Image not found");
  }
  let photo: MediaInfoJSON | null;
  try {
    photo = await loadPhoto(event, raw);
  } catch (error) {
    console.error("Failed to load the photo:", error);
    throw event.error(503, UNAVAILABLE);
  }
  if (photo === null) {
    throw event.error(404, "Image not found");
  }
  const { media } = await event.resolveValue(useGalleryIndex);
  return {
    photo,
    unlisted: !media.some((m) => m.id === photo.id),
    ogp: photoOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      photo,
    ),
  };
});

// The photo's own page; the list it was opened from (tags, sort, camera)
// is read from the query.
export default component$(() => {
  const page = usePhotoPage();
  return <PhotoDetail photo={page.value.photo} />;
});

export const head: DocumentHead = ({ resolveValue }) => {
  const page = resolveValue(usePhotoPage);
  const head = ogpHead(page.ogp);
  return page.unlisted
    ? { ...head, meta: [...head.meta, { name: "robots", content: "noindex" }] }
    : head;
};
