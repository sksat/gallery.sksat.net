import { component$, Slot } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import type {
  DocumentHeadProps,
  DocumentHeadValue,
} from "@builder.io/qwik-city";

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
 * The photo of both its pages, `/photo/<id>/` (the photo open over its
 * list) and `/photo/<id>/detail/`, from the API: public or unlisted (an
 * unlisted photo opens by its URL but is in no list), 404 for a private or
 * unknown one.
 */
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
  // A photo merged into another one (a retouch of it): the API answers
  // that photo for the old id, and its shared links lead there. Not a 301,
  // which browsers keep for good: a merge can be undone. The page there
  // names its own URL as canonical.
  if (photo.id !== raw) {
    const { pathname, search } = event.url;
    throw event.redirect(
      302,
      pathname.replace(`/photo/${raw}/`, `/photo/${photo.id}/`) + search,
    );
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

/**
 * The head of both pages: the photo's card, its URL (`/photo/<id>/`, the
 * one shared) as the canonical URL of both, and noindex when unlisted.
 */
export const photoHead = ({
  resolveValue,
  url,
}: DocumentHeadProps): DocumentHeadValue => {
  const page = resolveValue(usePhotoPage);
  const head = ogpHead(page.ogp);
  return {
    ...head,
    meta: page.unlisted
      ? [...head.meta, { name: "robots", content: "noindex" }]
      : head.meta,
    links: [
      { rel: "canonical", href: `${url.origin}/photo/${page.photo.id}/` },
    ],
  };
};

export default component$(() => <Slot />);
