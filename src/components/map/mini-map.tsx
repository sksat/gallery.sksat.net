import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

import { uncertaintyMeters } from "@shared/map/map";

import type { MediaLocation } from "../gallery/types";
import { loadMapLibre, mapStyleUrl } from "./maplibre";
import { mapHrefFor, placeLabel, ZOOM_FOR } from "./places";
import { drawPlaces } from "./render";

/**
 * A small map for a photo's page: where it was taken, as precisely as its
 * location level allows (an area for an approximate one). Shows the
 * position as text until MapLibre has loaded (it loads once the box
 * scrolls into view), and the whole box links to /map/ on that photo.
 * Pass only a public `location` (MediaInfoJSON.location); render nothing
 * without one. Not for VRChat photos (no real-world position).
 */
export const MiniMap = component$<{
  photoId: string;
  location: MediaLocation;
}>(({ photoId, location }) => {
  const container = useSignal<HTMLElement>();
  const ready = useSignal(false);
  const label = placeLabel(
    location.latitude,
    location.longitude,
    location.precision,
  );

  // eslint-disable-next-line qwik/no-use-visible-task -- the map is browser only
  useVisibleTask$(async ({ cleanup }) => {
    const el = container.value;
    if (!el) return;
    // An object: TypeScript would narrow a plain `let` to false.
    const life = { gone: false };
    let dispose = () => {};
    cleanup(() => {
      life.gone = true;
      dispose();
    });
    let lib: Awaited<ReturnType<typeof loadMapLibre>>;
    let map: InstanceType<typeof lib.Map>;
    try {
      lib = await loadMapLibre();
      if (life.gone) return;
      map = new lib.Map({
        container: el,
        style: mapStyleUrl(),
        center: [location.longitude, location.latitude],
        zoom: ZOOM_FOR[location.precision] - 1,
        interactive: false,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // No WebGL: the position stays as text.
      console.error("mini map:", err);
      return;
    }
    const accent =
      getComputedStyle(el).getPropertyValue("--color-accent").trim() ||
      "#18b6f6";
    const drawn = drawPlaces(
      lib,
      map,
      [
        {
          key: `${location.precision}:${location.latitude},${location.longitude}`,
          lat: location.latitude,
          lng: location.longitude,
          precision: location.precision,
          items: [{ id: photoId, file: null, taken: null }],
          label,
          radius: uncertaintyMeters(location.precision),
        },
      ],
      accent,
    );
    dispose = () => {
      drawn.remove();
      map.remove();
    };
    ready.value = true;
  });

  return (
    <div
      data-testid="mini-map"
      // A card like the calendar's next to it on the photo page.
      class="relative h-44 w-full overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10 sm:h-auto sm:min-h-44 lg:h-44"
    >
      {/* A picture of the place: its marker and controls are inert (the
          link over it is the one thing to focus or tap). */}
      <div ref={container} inert class="absolute inset-0" />
      {!ready.value && (
        <p class="absolute inset-0 grid place-items-center p-3 text-center text-sm opacity-80">
          {label}
        </p>
      )}
      {/* Plain <a>: see the note in components/layout/header.tsx. */}
      <a
        href={mapHrefFor(photoId)}
        aria-label={`地図で見る（${label}）`}
        class="absolute inset-0"
      />
    </div>
  );
});
