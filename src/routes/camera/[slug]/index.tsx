import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { findCamera, parseCameras } from "~/components/gallery/cameras";
import {
  transformMediaInfo,
  type MediaInfoJSON,
} from "~/components/gallery/types";
import { cameraOgp, ogpHead, type Ogp } from "~/components/ogp";

// The gallery reads the camera (from the path), photo, tag filter and sort
// order itself; this loader resolves the camera for the head and the 404.
export default component$(() => <Gallery />);

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCameraOgp));

export const useCameraOgp = routeLoader$<Ogp>(async (event) => {
  const base = import.meta.env.VITE_S3_BASE_URL;
  const [mediaRes, camerasRes] = await Promise.all([
    fetch(base + "/media.json"),
    // Optional: before the admin publishes it, media.json alone is enough.
    fetch(base + "/cameras.json").catch(() => null),
  ]);
  if (!mediaRes.ok) {
    throw event.error(500, "Failed to fetch media index");
  }
  const media: MediaInfoJSON[] = await mediaRes.json();
  const cameras = camerasRes?.ok
    ? parseCameras(await camerasRes.json().catch(() => null))
    : null;

  const camera = findCamera(
    cameras,
    media.map(transformMediaInfo),
    event.params.slug,
  );
  if (camera === null) {
    throw event.error(404, "Camera not found");
  }
  return cameraOgp(
    { s3Base: base, imageBase: import.meta.env.VITE_IMAGE_BASE_URL },
    media,
    camera,
  );
});
