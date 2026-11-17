import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { legacyIndex } from "~/components/gallery/logic";
import { PUBLIC_ID_RE, type MediaInfoJSON } from "~/components/gallery/types";
import { ogpHead, photoOgp, type Ogp } from "~/components/ogp";
import { loadPhoto } from "~/lib/api";
import { useGalleryIndex } from "../../layout";
import { legacyRedirect } from "./legacy";

type PhotoPage = {
  photo: MediaInfoJSON;
  ogp: Ogp;
  /** Not in the public list: an unlisted photo, kept out of search. */
  unlisted: boolean;
};

/**
 * The photo, from the API: public or unlisted (an unlisted photo opens by
 * its URL but is in no list), 404 for a private or unknown one. An old
 * /photo/N URL is redirected to the photo's public id.
 */
export const usePhotoPage = routeLoader$<PhotoPage>(async (event) => {
  const raw = event.params.imageId;
  const legacy = legacyIndex(raw);
  if (legacy !== null) {
    await legacyRedirect(event, legacy, event.url.searchParams);
  }
  if (!PUBLIC_ID_RE.test(raw)) {
    throw event.error(404, "Image not found");
  }
  let photo: MediaInfoJSON | null;
  try {
    photo = await loadPhoto(event, raw);
  } catch (error) {
    console.error("Failed to load the photo:", error);
    throw event.error(500, "Failed to fetch the photo");
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

// The gallery reads the photo id (from the path) and tag filter itself; the
// photo is passed in too, since an unlisted one is not in its list.
export default component$(() => {
  const page = usePhotoPage();
  return <Gallery photo={page.value.photo} />;
});

export const head: DocumentHead = ({ resolveValue }) => {
  const page = resolveValue(usePhotoPage);
  const head = ogpHead(page.ogp);
  return page.unlisted
    ? { ...head, meta: [...head.meta, { name: "robots", content: "noindex" }] }
    : head;
};
