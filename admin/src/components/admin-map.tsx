import {
  component$,
  noSerialize,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
  type Signal,
} from "@builder.io/qwik";

import { boundsOf, clusterByGrid, type Place } from "@shared/map/map";
import { imageUrl } from "~/lib/images";
import { platformOf, type Platform } from "~/lib/platform";
import { usePlatformList } from "~/routes/layout";
import {
  currentMapStyle,
  formatPosition,
  loadMapLibre,
  type LocatedPhoto,
} from "~/lib/map";
import { VISIBILITY_ICON, VISIBILITY_LABELS_JA } from "./visibility-style";

export type AdminPlace = Place<LocatedPhoto>;

const SVG_NS = "http://www.w3.org/2000/svg";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * appendChild for each child (strings as text). Not `append`: the Workers
 * types' HTMLRewriter Element shadows the DOM's in this project.
 */
const put = (parent: Node, ...kids: (Node | string)[]): void => {
  for (const k of kids) {
    parent.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  }
};

const icon = (path: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "size-3.5 shrink-0");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("fill-rule", "evenodd");
  p.setAttribute("d", path);
  put(svg, p);
  return svg;
};

/** A thumbnail, or the platform's colour without the image Worker. */
const thumb = (
  photo: LocatedPhoto,
  imageBase: string | null,
  platforms: readonly Platform[],
) => {
  if (imageBase) {
    const img = el("img", "h-full w-full object-cover");
    img.src = imageUrl(imageBase, photo.file, "h240");
    img.alt = "";
    img.loading = "lazy";
    return img;
  }
  return el(
    "span",
    [
      "block h-full w-full",
      platformOf(platforms, photo.platform).kind === "virtual"
        ? "bg-violet-300"
        : "bg-emerald-300",
    ].join(" "),
  );
};

/**
 * The admin's map of every photo with a position, private ones too, at
 * the saved (exact) position. Markers are DOM buttons, merged where they
 * would overlap; a place's popup lists its photos with their visibility
 * and links to their edit pages. `focus` shows a place (from the list).
 */
export const AdminMap = component$<{
  places: AdminPlace[];
  imageBase: string | null;
  focus: Signal<{ key: string } | null>;
}>(({ places, imageBase, focus }) => {
  const container = useSignal<HTMLElement>();
  const platforms = usePlatformList().value;
  const show = useSignal<NoSerialize<(key: string) => void>>();
  const ready = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task -- the map is browser only
  useVisibleTask$(async ({ cleanup }) => {
    const box = container.value;
    if (!box) return;
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
        container: box,
        style: currentMapStyle(),
        attributionControl: { compact: true },
        // Touch screens: one finger scrolls the page, two move the map.
        cooperativeGestures: matchMedia("(pointer: coarse)").matches,
        locale: {
          "CooperativeGesturesHandler.MobileHelpText":
            "2本の指で地図を動かせます",
        },
        ...(bounds
          ? { bounds, fitBoundsOptions: { padding: 64, maxZoom: 14 } }
          : { center: [139.7, 35.7], zoom: 3 }),
      });
    } catch (err) {
      // No map (no WebGL): the list below has every place.
      console.error("map:", err);
      return;
    }
    map.addControl(new lib.NavigationControl({ showCompass: false }));
    let markers: InstanceType<typeof lib.Marker>[] = [];
    let popup: InstanceType<typeof lib.Popup> | null = null;

    const openPopup = (place: AdminPlace) => {
      popup?.remove();
      const root = el("div", "w-64 text-zinc-900");
      root.dataset.testid = "map-popup";
      put(
        root,
        el(
          "p",
          "mb-2 text-xs font-semibold tabular-nums",
          formatPosition(place.lat, place.lng),
        ),
      );
      const list = el("ul", "max-h-64 space-y-1 overflow-y-auto");
      for (const photo of place.items) {
        const a = el(
          "a",
          "flex items-center gap-2 rounded p-1 text-xs hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-600",
        );
        a.href = `/media/${photo.id}/`;
        a.dataset.testid = "map-popup-photo";
        const t = el("span", "block size-10 shrink-0 overflow-hidden rounded");
        put(t, thumb(photo, imageBase, platforms));
        const name = el(
          "span",
          "min-w-0 flex-1 truncate",
          photo.path.slice(photo.path.lastIndexOf("/") + 1),
        );
        const vis = el("span", "flex items-center gap-1 text-zinc-600");
        put(
          vis,
          icon(VISIBILITY_ICON[photo.visibility]),
          VISIBILITY_LABELS_JA[photo.visibility],
        );
        put(a, t, name, vis);
        const li = el("li", "");
        put(li, a);
        put(list, li);
      }
      put(root, list);
      popup = new lib.Popup({ offset: 22, maxWidth: "300px" })
        .setLngLat([place.lng, place.lat])
        .setDOMContent(root)
        .addTo(map);
    };

    const button = (label: string, testId: string) => {
      const b = el(
        "button",
        "relative grid size-11 place-items-center rounded-full border-2 border-white bg-zinc-800 shadow-md focus-visible:outline-3 focus-visible:outline-sky-500",
      );
      b.type = "button";
      b.dataset.testid = testId;
      b.setAttribute("aria-label", label);
      return b;
    };

    let level = Number.NaN;
    const render = (force = false) => {
      const zoom = Math.floor(map.getZoom());
      if (!force && zoom === level) return;
      level = zoom;
      for (const m of markers) m.remove();
      markers = clusterByGrid([...places], zoom).map(
        ({ lat, lng, members }) => {
          const n = members.reduce((s, p) => s + p.items.length, 0);
          const single = members.length === 1;
          const b = button(
            single
              ? `${formatPosition(lat, lng)} ${n}枚`
              : `${members.length}か所 ${n}枚 (拡大)`,
            single ? "map-marker" : "map-cluster",
          );
          if (single) b.dataset.place = members[0].key;
          const face = el(
            "span",
            "block size-full overflow-hidden rounded-full",
          );
          put(face, thumb(members[0].items[0], imageBase, platforms));
          put(b, face);
          if (n > 1) {
            put(
              b,
              el(
                "span",
                "absolute -right-1.5 -bottom-1.5 min-w-5 rounded-full bg-sky-600 px-1 text-xs leading-5 font-semibold text-white",
                String(n),
              ),
            );
          }
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (single) return openPopup(members[0]);
            // Zoom in until they part; where they would not, list them all.
            const bb = boundsOf(members);
            const camera = bb && map.cameraForBounds(bb, { padding: 80 });
            const zoom = Math.min(camera?.zoom ?? Infinity, 18);
            if (zoom <= map.getZoom() + 0.5) {
              return openPopup({
                ...members[0],
                lat,
                lng,
                items: members.flatMap((m) => m.items),
              });
            }
            map.easeTo({ center: camera?.center ?? [lng, lat], zoom });
          });
          return new lib.Marker({ element: b })
            .setLngLat([lng, lat])
            .addTo(map);
        },
      );
    };
    map.on("zoomend", () => render());
    render(true);

    show.value = noSerialize((key: string) => {
      const place = places.find((p) => p.key === key);
      if (!place) return;
      map.jumpTo({
        center: [place.lng, place.lat],
        zoom: Math.max(map.getZoom(), 15),
      });
      render();
      openPopup(place);
    });
    dispose = () => {
      show.value = undefined;
      popup?.remove();
      for (const m of markers) m.remove();
      map.remove();
    };
    ready.value = true;
  });

  // eslint-disable-next-line qwik/no-use-visible-task -- follows the list
  useVisibleTask$(({ track }) => {
    const target = track(() => focus.value);
    track(() => ready.value);
    if (target && ready.value) show.value?.(target.key);
  });

  return (
    <div
      ref={container}
      role="region"
      aria-label="写真の地図"
      data-testid="admin-map"
      data-ready={ready.value ? "" : undefined}
      class="h-[60vh] min-h-72 w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
    />
  );
});
