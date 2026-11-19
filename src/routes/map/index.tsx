import { component$, useSignal } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { imageUrl } from "~/components/gallery/images";
import { PUBLIC_ID_RE } from "~/components/gallery/types";
import { TopLine } from "~/components/layout/site-nav";
import { PhotoMap } from "~/components/map/photo-map";
import { placeOf, publicPlaces, type MapPlace } from "~/components/map/places";
import { mapOgp, ogpHead, type Ogp } from "~/components/ogp";
import { useGalleryIndex } from "../layout";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

type MapPage = {
  places: MapPlace[];
  /** `?photo=<public id>`: the place to show first. */
  focus: string | null;
  ogp: Ogp;
};

/** /map/: every public photo whose position is public (not VRChat). */
export const useMapPage = routeLoader$<MapPage>(async (event) => {
  const { media } = await event.resolveValue(useGalleryIndex);
  const places = publicPlaces(media);
  const photo = event.url.searchParams.get("photo");
  return {
    places,
    focus: placeOf(places, photo && PUBLIC_ID_RE.test(photo) ? photo : null),
    ogp: mapOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      media,
    ),
  };
});

export default component$(() => {
  const page = useMapPage();
  const { places } = page.value;
  const focus = useSignal<{ key: string; moveFocus?: boolean } | null>(
    page.value.focus ? { key: page.value.focus } : null,
  );
  const count = places.reduce((n, p) => n + p.items.length, 0);
  return (
    <div class="px-2 py-3 sm:px-3">
      <TopLine />
      <h1 class="mb-3 px-1 text-2xl font-semibold tracking-tight sm:text-3xl">
        地図
      </h1>
      {places.length === 0 ? (
        <p class="px-1 opacity-80">
          撮影場所を公開している写真はまだありません。
        </p>
      ) : (
        <>
          <PhotoMap places={places} focus={focus} />
          {/* The same places as a list: for the keyboard and screen
              readers, and to find a place on the map. */}
          <section aria-label="場所の一覧" class="mt-4 px-1">
            <p class="mb-2 text-sm opacity-80">
              {places.length} か所 · {count} 枚
            </p>
            <ul class="flex flex-col gap-3" data-testid="map-list">
              {places.map((place) => (
                <li
                  key={place.key}
                  data-testid="map-list-place"
                  class="flex flex-wrap items-center gap-x-3 gap-y-2"
                >
                  <button
                    type="button"
                    class="min-h-11 rounded border border-white/30 px-3 text-left text-sm hover:border-white/70"
                    onClick$={() => {
                      focus.value = { key: place.key, moveFocus: true };
                      document
                        .querySelector("[data-testid=photo-map]")
                        ?.scrollIntoView({ block: "nearest" });
                    }}
                  >
                    {place.label}
                    <span class="ml-2 tabular-nums opacity-70">
                      {place.items.length} 枚
                    </span>
                  </button>
                  <span class="flex flex-wrap gap-1">
                    {place.items.map((photo) => (
                      // Plain <a>: see the note in layout/header.tsx.
                      <a
                        key={photo.id}
                        href={`/photo/${photo.id}/`}
                        class="block size-11 overflow-hidden rounded"
                      >
                        <img
                          src={imageUrl(S3_BASE, photo, IMAGE_BASE, "h240")}
                          alt={photo.taken ? `${photo.taken}の写真` : "写真"}
                          width={44}
                          height={44}
                          loading="lazy"
                          decoding="async"
                          class="h-full w-full object-cover"
                        />
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useMapPage).ogp);
