import { component$, Slot, useStyles$ } from "@builder.io/qwik";
import { routeLoader$, type RequestHandler } from "@builder.io/qwik-city";

import Header from "~/components/layout/header";
import Footer from "~/components/layout/footer";
import type { CameraJSON, MediaInfoJSON } from "~/components/gallery/types";
import { loadCameras, loadMedia } from "~/lib/api";

import styles from "./styles.css?inline";

export type GalleryIndex = {
  /** Public photos only: unlisted ones never appear in lists. */
  media: MediaInfoJSON[];
  /** Cameras that have a public photo. */
  cameras: CameraJSON[];
};

/**
 * The photo and camera lists from the API Worker, shared by every page (the
 * gallery, camera pages and the camera list). A 500 rather than an empty
 * gallery when the API fails: responses may be served stale for a week, and
 * that must not pin an outage as "no photos".
 */
export const useGalleryIndex = routeLoader$<GalleryIndex>(async (event) => {
  try {
    const [media, cameras] = await Promise.all([
      loadMedia(event),
      loadCameras(event),
    ]);
    return { media, cameras };
  } catch (error) {
    console.error("Failed to load the photo index:", error);
    throw event.error(500, "Failed to fetch the photo index");
  }
});

export const onGet: RequestHandler = async ({ cacheControl }) => {
  // Control caching for this request for best performance and to reduce hosting costs:
  // https://qwik.builder.io/docs/caching/
  cacheControl({
    // Always serve a cached response by default, up to a week stale
    staleWhileRevalidate: 60 * 60 * 24 * 7,
    // Max once every 5 seconds, revalidate on the server to get a fresh version of this page
    maxAge: 5,
  });
};

export default component$(() => {
  useStyles$(styles);
  return (
    <>
      <Header />
      <main>
        <Slot />
      </main>
      <Footer />
    </>
  );
});
