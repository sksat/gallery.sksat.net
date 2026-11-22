import { component$ } from "@builder.io/qwik";
import {
  routeLoader$,
  type DocumentHead,
  type RequestHandler,
} from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import type { CameraJSON } from "~/components/gallery/types";
import { cameraOgp, ogpHead, type Ogp } from "~/components/ogp";
import { loadCamera, UNAVAILABLE } from "~/lib/api";
import { useGalleryIndex } from "../../layout";

type CameraPage = { camera: CameraJSON; ogp: Ogp };

const OLD_LIST_PARAMS = new Set(["tag", "mode", "sort", "seed"]);

/**
 * The camera page's filters and sort order moved to the gallery's camera
 * filter: a shared link with them opens the same photos there.
 */
export const onGet: RequestHandler = ({ url, params, redirect }) => {
  const query = new URLSearchParams(url.search);
  if ([...query.keys()].some((key) => OLD_LIST_PARAMS.has(key))) {
    const to = new URLSearchParams([["camera", params.slug]]);
    for (const [key, value] of query)
      if (OLD_LIST_PARAMS.has(key)) to.append(key, value);
    throw redirect(301, `/?${to}`);
  }
};

/**
 * The camera, from the API: 404 when there is none, or when only private
 * photos were taken with it. The gallery reads the photo, tag filter and
 * sort order from the URL itself.
 */
export const useCameraPage = routeLoader$<CameraPage>(async (event) => {
  let camera: CameraJSON | null;
  try {
    camera = await loadCamera(event, event.params.slug);
  } catch (error) {
    console.error("Failed to load the camera:", error);
    throw event.error(503, UNAVAILABLE);
  }
  if (camera === null) {
    throw event.error(404, "Camera not found");
  }
  const { media } = await event.resolveValue(useGalleryIndex);
  return {
    camera,
    ogp: cameraOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      media,
      camera,
    ),
  };
});

// The gallery lists the photos digitised with it after its own.
export default component$(() => {
  const page = useCameraPage();
  return <Gallery camera={page.value.camera} />;
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCameraPage).ogp);
