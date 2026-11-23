import { component$, useComputed$ } from "@builder.io/qwik";
import {
  routeLoader$,
  type DocumentHead,
  type RequestHandler,
} from "@builder.io/qwik-city";

import { CameraProfile } from "~/components/gallery/camera-profile";
import {
  cameraFacts,
  digitizedWith,
  takenWith,
} from "~/components/gallery/cameras";
import {
  DigitizedList,
  SectionHeading,
} from "~/components/gallery/digitized-list";
import Gallery from "~/components/gallery/gallery";
import { galleryUrl } from "~/components/gallery/logic";
import { DEFAULT_SORT } from "~/components/gallery/sort";
import { DEFAULT_TAG_MODE, mediaTags } from "~/components/gallery/tags";
import {
  transformMediaInfo,
  type CameraJSON,
} from "~/components/gallery/types";
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
 * photos were taken with it.
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

/**
 * How many of the camera's photos its page shows first (newest first), and
 * how many more each time the end of them scrolls into view.
 */
const PAGE = 12;

// The camera first, then the photos taken with it (more as the page
// scrolls, and a link to them in the gallery), then the ones digitised
// with it.
export default component$(() => {
  const page = useCameraPage();
  const index = useGalleryIndex();
  const data = useComputed$(() => {
    const media = index.value.media.map(transformMediaInfo);
    const slug = page.value.camera.slug;
    // A tag links to the camera's photos with it: only when there are any.
    const tagged = new Set(
      media.filter((m) => takenWith(m, slug)).flatMap(mediaTags),
    );
    return {
      facts: cameraFacts(media, slug),
      digitized: digitizedWith(media, slug),
      taggedTags: page.value.camera.tags.filter((t) => tagged.has(t)),
    };
  });
  const { camera } = page.value;
  const { facts, digitized, taggedTags } = data.value;
  const galleryHref = galleryUrl(
    { tags: [], mode: DEFAULT_TAG_MODE },
    DEFAULT_SORT,
    camera.slug,
  );
  return (
    <div class="py-2">
      <div class="px-1 sm:px-2">
        <CameraProfile camera={camera} facts={facts} taggedTags={taggedTags} />
      </div>
      {facts.count > 0 && (
        <section
          aria-labelledby="camera-photos"
          data-testid="camera-photos"
          class="mt-8"
        >
          <div class="px-2 sm:px-3">
            <SectionHeading
              id="camera-photos"
              // With the gallery's tag filter and sort order.
              href={galleryHref}
              linkText="ギャラリーで見る"
            >
              このカメラで撮影した写真
            </SectionHeading>
          </div>
          <Gallery camera={camera} limit={PAGE} moreHref={galleryHref} />
        </section>
      )}
      <DigitizedList media={digitized} />
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCameraPage).ogp);
