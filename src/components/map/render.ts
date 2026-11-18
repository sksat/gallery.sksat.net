/**
 * Draws places on a MapLibre map (browser only; called from the map
 * components' visible tasks). Places become DOM markers (buttons, so they
 * are focusable and testable without WebGL), merged by clusterByGrid
 * where they would overlap; approximate places also get their area drawn
 * as a circle.
 */
import type { Map as MapLibreMap, Marker, Popup } from "maplibre-gl";

import { boundsOf, circleRing, clusterByGrid } from "@shared/map/map";

import { imageUrl } from "../gallery/images";
import type { MapLibreModule } from "./maplibre";
import { ZOOM_FOR, type MapPlace } from "./places";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

const AREAS = "photo-areas";

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

const thumb = (place: MapPlace, i = 0) =>
  imageUrl(S3_BASE, place.items[i], IMAGE_BASE, "h240");

/** The popup of a place: its photos as links to their pages. */
const popupContent = (place: MapPlace): HTMLElement => {
  const root = el("div", "photo-map-popup");
  root.dataset.testid = "map-popup";
  root.append(el("p", "photo-map-popup-label", place.label));
  const grid = el("div", "photo-map-popup-grid");
  // As many columns as photos, up to three.
  grid.style.gridTemplateColumns = `repeat(${Math.min(place.items.length, 3)}, 80px)`;
  for (const photo of place.items) {
    const a = el("a", "");
    a.href = `/photo/${photo.id}/`;
    a.dataset.testid = "map-popup-photo";
    const img = el("img", "");
    img.src = imageUrl(S3_BASE, photo, IMAGE_BASE, "h240");
    img.alt = photo.taken ? `${photo.taken}の写真` : "写真";
    img.loading = "lazy";
    a.append(img);
    grid.append(a);
  }
  root.append(grid);
  return root;
};

export type PlacesLayer = {
  /**
   * Go to a place and open its popup; `moveFocus` puts the keyboard focus
   * in it (a choice from the list, not the page opening on `?photo=`).
   */
  focus: (key: string, moveFocus: boolean) => void;
  remove: () => void;
};

/**
 * Shows `places` on `map`: areas once the style has loaded, markers now
 * and again whenever the zoom crosses a whole level.
 */
export const drawPlaces = (
  lib: MapLibreModule,
  map: MapLibreMap,
  places: readonly MapPlace[],
  accent: string,
): PlacesLayer => {
  let markers: { marker: Marker; keys: string[] }[] = [];
  let popup: Popup | null = null;
  let level = Number.NaN;
  /** After a cluster click: the place whose new marker gets the focus. */
  let refocus: string | null = null;

  const openPopup = (place: MapPlace, moveFocus = true) => {
    popup?.remove();
    popup = new lib.Popup({
      offset: 22,
      maxWidth: "300px",
      focusAfterOpen: moveFocus,
    })
      .setLngLat([place.lng, place.lat])
      .setDOMContent(popupContent(place))
      .addTo(map);
  };

  /** One popup for places that cannot be told apart by zooming. */
  const openCombined = (members: MapPlace[], lat: number, lng: number) =>
    openPopup({
      ...members[0],
      key: members.map((m) => m.key).join("|"),
      lat,
      lng,
      label: members.map((m) => m.label).join(" / "),
      items: members.flatMap((m) => m.items),
    });

  const placeMarker = (place: MapPlace): HTMLElement => {
    const n = place.items.length;
    const b = el(
      "button",
      place.radius > 0 ? "photo-map-marker is-area" : "photo-map-marker",
    );
    b.type = "button";
    b.dataset.testid = "map-marker";
    b.dataset.place = place.key;
    b.setAttribute("aria-label", `${place.label} ${n}枚`);
    if (place.radius === 0) {
      const img = el("img", "");
      img.src = thumb(place);
      img.alt = "";
      b.append(img);
    }
    if (n > 1 || place.radius > 0) b.append(el("span", "count", String(n)));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopup(place);
    });
    return b;
  };

  const clusterMarker = (members: MapPlace[], lat: number, lng: number) => {
    const n = members.reduce((s, p) => s + p.items.length, 0);
    const b = el("button", "photo-map-marker is-cluster");
    b.type = "button";
    b.dataset.testid = "map-cluster";
    b.setAttribute("aria-label", `${members.length}か所 ${n}枚 (拡大)`);
    const img = el("img", "");
    img.src = thumb(members[0]);
    img.alt = "";
    b.append(img, el("span", "count", String(n)));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      // Zoom in until they part; where they never would (the same spot,
      // or too close even at the deepest zoom), list them all instead.
      const bounds = boundsOf(members);
      const camera = bounds && map.cameraForBounds(bounds, { padding: 80 });
      const zoom = Math.min(camera?.zoom ?? Infinity, MAX_CLUSTER_ZOOM);
      if (zoom <= map.getZoom() + 0.5) {
        openCombined(members, lat, lng);
        return;
      }
      // Only when the markers will be rebuilt (a whole level further).
      refocus =
        Math.floor(zoom) !== Math.floor(map.getZoom()) ? members[0].key : null;
      map.easeTo({ center: camera?.center ?? [lng, lat], zoom });
    });
    return b;
  };

  const render = (force = false) => {
    const zoom = Math.floor(map.getZoom());
    if (!force && zoom === level) return;
    level = zoom;
    for (const m of markers) m.marker.remove();
    markers = clusterByGrid([...places], zoom).map(({ lat, lng, members }) => ({
      keys: members.map((m) => m.key),
      marker: new lib.Marker({
        element:
          members.length === 1
            ? placeMarker(members[0])
            : clusterMarker(members, lat, lng),
      })
        .setLngLat([lng, lat])
        .addTo(map),
    }));
    if (refocus !== null) {
      const key = refocus;
      refocus = null;
      markers
        .find((m) => m.keys.includes(key))
        ?.marker.getElement()
        .focus();
    }
  };
  const onZoom = () => render();

  const addAreas = () => {
    if (map.getSource(AREAS)) return;
    map.addSource(AREAS, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: places
          .filter((p) => p.radius > 0)
          .map((p) => ({
            type: "Feature",
            properties: { key: p.key },
            geometry: {
              type: "Polygon",
              coordinates: [circleRing(p.lat, p.lng, p.radius)],
            },
          })),
      },
    });
    map.addLayer({
      id: `${AREAS}-fill`,
      type: "fill",
      source: AREAS,
      paint: { "fill-color": accent, "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: `${AREAS}-line`,
      type: "line",
      source: AREAS,
      paint: { "line-color": accent, "line-opacity": 0.7, "line-width": 1.5 },
    });
  };

  if (map.isStyleLoaded()) addAreas();
  else map.once("load", addAreas);
  map.on("zoomend", onZoom);
  render(true);

  return {
    focus: (key, moveFocus) => {
      const place = places.find((p) => p.key === key);
      if (!place) return;
      map.jumpTo({
        center: [place.lng, place.lat],
        zoom: Math.max(map.getZoom(), ZOOM_FOR[place.precision]),
      });
      render();
      openPopup(place, moveFocus);
    },
    remove: () => {
      map.off("zoomend", onZoom);
      popup?.remove();
      for (const m of markers) m.marker.remove();
    },
  };
};

/** The deepest zoom a cluster click goes to (street level). */
const MAX_CLUSTER_ZOOM = 17;
