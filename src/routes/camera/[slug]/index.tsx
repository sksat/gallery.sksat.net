import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { digitizedWith } from "~/components/gallery/cameras";
import { DigitizedList } from "~/components/gallery/digitized-list";
import Gallery from "~/components/gallery/gallery";
import {
  transformMediaInfo,
  type CameraJSON,
} from "~/components/gallery/types";
import { cameraOgp, ogpHead, type Ogp } from "~/components/ogp";
import { loadCamera, UNAVAILABLE } from "~/lib/api";
import { useGalleryIndex } from "../../layout";

type CameraPage = { camera: CameraJSON; ogp: Ogp };

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

export default component$(() => {
  const page = useCameraPage();
  const index = useGalleryIndex();
  const digitized = digitizedWith(
    index.value.media.map(transformMediaInfo),
    page.value.camera.slug,
  );
  return (
    <>
      <Gallery camera={page.value.camera} />
      <DigitizedList media={digitized} />
    </>
  );
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCameraPage).ogp);
