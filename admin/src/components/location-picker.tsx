import {
  component$,
  noSerialize,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
} from "@builder.io/qwik";

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

type Position = { lat: number; lng: number };

/**
 * What the inputs hold now: a position, "empty" (both cleared) or null
 * (half typed or not a position: leave the pin where it is).
 */
const readPosition = (
  inputs: ReturnType<typeof positionInputs>,
): Position | "empty" | null => {
  const lat = inputs.lat?.value.trim() ?? "";
  const lng = inputs.lng?.value.trim() ?? "";
  if (lat === "" && lng === "") return "empty";
  const la = Number(lat);
  const lo = Number(lng);
  return lat !== "" && lng !== "" && isLatLng(la, lo)
    ? { lat: la, lng: lo }
    : null;
};

/**
 * Fill (or empty) the inputs as typing would: input and change events, so
 * the form sees an edit (its leave guard; saving sends the position, which
 * then becomes `manual`).
 */
const writePosition = (el: HTMLElement, pos: Position | null) => {
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
 *
 * The inputs are followed from the page's start; MapLibre loads only once
 * the map scrolls into view, and its pin then starts from what the inputs
 * hold (not from the saved position, which may have been edited since).
 */
export const LocationPicker = component$<{
  latitude: number | null;
  longitude: number | null;
}>(({ latitude, longitude }) => {
  const box = useSignal<HTMLElement>();
  const has = useSignal(isLatLng(latitude, longitude));
  /** Moves or drops the pin; set once the map is there. */
  const pinTo = useSignal<NoSerialize<(pos: Position | "empty") => void>>();

  // Follow the inputs whether or not the map has loaded.
  // eslint-disable-next-line qwik/no-use-visible-task -- reads the DOM
  useVisibleTask$(
    ({ cleanup }) => {
      const el = box.value;
      if (!el) return;
      const inputs = positionInputs(el);
      const follow = () => {
        const pos = readPosition(inputs);
        if (pos === null) return;
        has.value = pos !== "empty";
        pinTo.value?.(pos);
      };
      inputs.lat?.addEventListener("change", follow);
      inputs.lng?.addEventListener("change", follow);
      // The inputs may have been edited before Qwik woke this up.
      follow();
      cleanup(() => {
        inputs.lat?.removeEventListener("change", follow);
        inputs.lng?.removeEventListener("change", follow);
      });
    },
    { strategy: "document-ready" },
  );

  // eslint-disable-next-line qwik/no-use-visible-task -- the map is browser only
  useVisibleTask$(({ cleanup }) => {
    const el = box.value;
    if (!el) return;
    const inputs = positionInputs(el);
    // An object: TypeScript would narrow a plain `let` to false.
    const life = { gone: false };
    let dispose = () => {};
    cleanup(() => {
      life.gone = true;
      dispose();
    });
    const load = async () => {
      let lib: Awaited<ReturnType<typeof loadMapLibre>>;
      let map: InstanceType<typeof lib.Map>;
      try {
        lib = await loadMapLibre();
        if (life.gone) return;
        // What the inputs hold now that the map can be made.
        const now = readPosition(inputs);
        const at = now !== null && now !== "empty" ? now : null;
        map = new lib.Map({
          container: el,
          style: currentMapStyle(),
          center: at ? [at.lng, at.lat] : [139.7, 35.7],
          zoom: at ? 14 : 4,
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
      dispose = () => {
        pinTo.value = undefined;
        map.remove();
      };
      map.addControl(new lib.NavigationControl({ showCompass: false }));
      let marker: InstanceType<typeof lib.Marker> | null = null;

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
          if (p) writePosition(el, { lat: p.lat, lng: p.lng });
        });
      };
      const show = (pos: Position | "empty") => {
        if (pos === "empty") {
          marker?.remove();
          marker = null;
        } else {
          place(pos.lng, pos.lat);
        }
      };
      // The inputs as they are now (edited while the map was loading, too).
      const now = readPosition(inputs);
      if (now !== null) show(now);
      pinTo.value = noSerialize(show);
      // A click writes the inputs; their change event moves the pin.
      map.on("click", (e) =>
        writePosition(el, { lat: e.lngLat.lat, lng: e.lngLat.lng }),
      );
      el.dataset.ready = "";
    };
    // Errors go to Qwik's error handling, as from any task.
    return load();
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
            // The inputs' change event updates `has` and the pin.
            if (box.value) writePosition(box.value, null);
          }}
        >
          位置を消す
        </button>
      )}
    </div>
  );
});
