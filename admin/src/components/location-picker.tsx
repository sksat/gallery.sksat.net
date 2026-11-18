import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

import { isLatLng } from "@shared/map/map";
import { currentMapStyle, loadMapLibre } from "~/lib/map";
import { buttonSecondary } from "./ui";

/** The 緯度 / 経度 inputs of the form `el` is in. */
const positionInputs = (el: HTMLElement) => {
  const form = el.closest("form");
  const get = (name: string) =>
    form?.querySelector<HTMLInputElement>(`input[name="${name}"]`) ?? null;
  return { lat: get("latitude"), lng: get("longitude") };
};

/**
 * Fill (or empty) the inputs as typing would: input and change events, so
 * the form sees an edit (its leave guard; saving sends the position, which
 * then becomes `manual`).
 */
const writePosition = (
  el: HTMLElement,
  pos: { lat: number; lng: number } | null,
) => {
  const inputs = positionInputs(el);
  const pairs = [
    [inputs.lat, pos?.lat],
    [inputs.lng, pos?.lng],
  ] as const;
  // Both values first, then the events: a listener sees the new pair.
  for (const [i, v] of pairs) {
    if (i) i.value = v === undefined ? "" : String(Number(v.toFixed(6)));
  }
  for (const [i] of pairs) {
    i?.dispatchEvent(new Event("input", { bubbles: true }));
    i?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Show the inputs (under 編集), so the new values can be seen and fixed.
  const details = inputs.lat?.closest("details");
  if (details) details.open = true;
};

/**
 * The edit page's map of where the photo was taken: a click puts the pin
 * there, the pin can be dragged, and 位置を消す removes it. It only fills
 * the form's 緯度 / 経度 inputs, and follows them when they are typed in.
 * MapLibre loads once the map scrolls into view.
 */
export const LocationPicker = component$<{
  latitude: number | null;
  longitude: number | null;
}>(({ latitude, longitude }) => {
  const box = useSignal<HTMLElement>();
  const has = useSignal(isLatLng(latitude, longitude));

  // eslint-disable-next-line qwik/no-use-visible-task -- the map is browser only
  useVisibleTask$(async ({ cleanup }) => {
    const el = box.value;
    if (!el) return;
    // An object: TypeScript would narrow a plain `let` to false.
    const life = { gone: false };
    let dispose = () => {};
    cleanup(() => {
      life.gone = true;
      dispose();
    });
    const inputs = positionInputs(el);
    const start =
      latitude !== null && longitude !== null && isLatLng(latitude, longitude)
        ? ([longitude, latitude] as [number, number])
        : null;
    let lib: Awaited<ReturnType<typeof loadMapLibre>>;
    let map: InstanceType<typeof lib.Map>;
    try {
      lib = await loadMapLibre();
      if (life.gone) return;
      map = new lib.Map({
        container: el,
        style: currentMapStyle(),
        center: start ?? [139.7, 35.7],
        zoom: start ? 14 : 4,
        attributionControl: { compact: true },
        // Touch screens: one finger scrolls the page (a stray tap while
        // scrolling would set a position), two move the map.
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
        locale: {
          "CooperativeGesturesHandler.MobileHelpText":
            "2本の指で地図を動かせます",
        },
      });
    } catch (err) {
      // No map (no WebGL): the inputs still work.
      console.error("location map:", err);
      return;
    }
    map.addControl(new lib.NavigationControl({ showCompass: false }));
    let marker: InstanceType<typeof lib.Marker> | null = null;

    const set = (lat: number, lng: number) => {
      writePosition(el, { lat, lng });
      has.value = true;
    };
    const place = (lng: number, lat: number) => {
      if (marker) {
        marker.setLngLat([lng, lat]);
        return;
      }
      marker = new lib.Marker({ draggable: true, color: "#0284c7" })
        .setLngLat([lng, lat])
        .addTo(map);
      const pin = marker.getElement();
      pin.dataset.testid = "location-pin";
      // A click on the pin is not a click on the map (which would move the
      // position to the clicked pixel, the pin's height above its tip).
      pin.addEventListener("click", (e) => e.stopPropagation());
      marker.on("dragend", () => {
        const p = marker?.getLngLat();
        if (p) set(p.lat, p.lng);
      });
    };
    if (start) place(start[0], start[1]);
    map.on("click", (e) => {
      place(e.lngLat.lng, e.lngLat.lat);
      set(e.lngLat.lat, e.lngLat.lng);
    });

    // The inputs changed (typed, or 位置を消す): move or drop the pin.
    const follow = () => {
      const lat = inputs.lat?.value.trim() ?? "";
      const lng = inputs.lng?.value.trim() ?? "";
      if (lat === "" && lng === "") {
        marker?.remove();
        marker = null;
        has.value = false;
        return;
      }
      const la = Number(lat);
      const lo = Number(lng);
      if (lat !== "" && lng !== "" && isLatLng(la, lo)) {
        place(lo, la);
        has.value = true;
      }
    };
    inputs.lat?.addEventListener("change", follow);
    inputs.lng?.addEventListener("change", follow);
    dispose = () => {
      inputs.lat?.removeEventListener("change", follow);
      inputs.lng?.removeEventListener("change", follow);
      map.remove();
    };
    el.dataset.ready = "";
  });

  return (
    <div class="mt-2 space-y-2">
      <div
        ref={box}
        data-testid="location-map"
        role="region"
        aria-label="撮影場所の地図"
        class="h-56 w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
      />
      {has.value && (
        <button
          type="button"
          class={buttonSecondary}
          onClick$={() => {
            if (!box.value) return;
            writePosition(box.value, null);
            has.value = false;
          }}
        >
          位置を消す
        </button>
      )}
    </div>
  );
});
