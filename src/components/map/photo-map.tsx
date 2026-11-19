import {
  component$,
  noSerialize,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type Signal,
} from "@builder.io/qwik";

import { boundsOf } from "@shared/map/map";

import { loadMapLibre, mapStyleUrl } from "./maplibre";
import type { MapPlace } from "./places";
import { drawPlaces, type PlacesLayer } from "./render";

/**
 * The map of /map/: every place with public photos. MapLibre and the tiles
 * load only once the map scrolls into view. `focus` holds the key of a
 * place to show with its popup (from `?photo=` or the list below the map).
 */
export const PhotoMap = component$<{
  places: MapPlace[];
  /**
   * A new object each time, so the same place can be shown again;
   * `moveFocus` puts the keyboard focus in its popup.
   */
  focus: Signal<{ key: string; moveFocus?: boolean } | null>;
}>(({ places, focus }) => {
  const container = useSignal<HTMLElement>();
  const layer = useSignal<NoSerialize<PlacesLayer>>();
  const ready = useSignal(false);
  const failed = useSignal(false);

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
    const bounds = boundsOf(places);
    let lib: Awaited<ReturnType<typeof loadMapLibre>>;
    let map: InstanceType<typeof lib.Map>;
    try {
      lib = await loadMapLibre();
      if (life.gone) return;
      map = new lib.Map({
        container: el,
        style: mapStyleUrl(),
        attributionControl: { compact: true },
        // Touch screens: one finger scrolls the page, two move the map.
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
        locale: {
          "CooperativeGesturesHandler.MobileHelpText":
            "2本の指で地図を動かせます",
        },
        ...(bounds
          ? { bounds, fitBoundsOptions: { padding: 64, maxZoom: 13 } }
          : { center: [139.7, 35.7], zoom: 3 }),
      });
    } catch (err) {
      // No WebGL, or the library did not download: the list below still
      // has every place.
      console.error("map:", err);
      failed.value = true;
      return;
    }
    map.addControl(
      new lib.NavigationControl({ showCompass: false }),
      "top-right",
    );
    const accent =
      getComputedStyle(el).getPropertyValue("--color-accent").trim() ||
      "#18b6f6";
    const drawn = drawPlaces(lib, map, places, accent);
    layer.value = noSerialize(drawn);
    dispose = () => {
      drawn.remove();
      map.remove();
    };
    // The other task then shows `focus` (from `?photo=`), if any.
    ready.value = true;
  });

  // eslint-disable-next-line qwik/no-use-visible-task -- follows the list's buttons
  useVisibleTask$(({ track }) => {
    const target = track(() => focus.value);
    track(() => ready.value);
    if (target && ready.value) {
      layer.value?.focus(target.key, target.moveFocus ?? false);
    }
  });

  return (
    <div class="relative">
      {/* MapLibre fills this element; nothing of ours goes in it. */}
      <div
        ref={container}
        role="region"
        aria-label="写真の地図"
        data-testid="photo-map"
        data-ready={ready.value ? "" : undefined}
        class="h-[60vh] min-h-72 w-full overflow-hidden rounded bg-white/5"
      />
      {failed.value && (
        <p class="absolute inset-0 grid place-items-center rounded bg-[var(--color-bg)] p-4 text-sm opacity-80">
          地図を表示できません
        </p>
      )}
    </div>
  );
});
