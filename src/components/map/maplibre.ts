/**
 * Loads MapLibre GL JS on demand: the map pages (and a photo's small map)
 * import it from a visible task, so no other page downloads it. Its CSS
 * and web worker are separate files that come with it.
 *
 * Tiles: OpenFreeMap (https://openfreemap.org/), free with no key, no
 * registration and no request limit, commercial use included. MapLibre
 * shows the attribution the style's sources carry (© OpenMapTiles, Data
 * from OpenStreetMap). OpenStreetMap's own tile servers are not used: their
 * usage policy is meant for light, non-app use only.
 * Tests point VITE_MAP_STYLE_URL at a local style with no tiles.
 */
import type * as MapLibre from "maplibre-gl";

export type MapLibreModule = typeof MapLibre;

/** The dark OpenFreeMap style, to match the site. */
export const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

export const mapStyleUrl = (): string =>
  import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE;

let loading: Promise<MapLibreModule> | null = null;

export const loadMapLibre = (): Promise<MapLibreModule> => {
  loading ??= (async () => {
    const [lib, worker, css] = await Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      import("maplibre-gl/dist/maplibre-gl.css?url"),
    ]);
    if (!document.querySelector("link[data-maplibre-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = css.default;
      link.dataset.maplibreCss = "";
      // The map is laid out by this CSS: wait for it (a failed load still
      // shows the map, only less tidy).
      await new Promise<void>((resolve) => {
        link.onload = link.onerror = () => resolve();
        document.head.append(link);
      });
    }
    lib.setWorkerUrl(worker.default);
    return lib;
  })();
  // A failed download (e.g. a stale deploy) may be retried next time.
  loading.catch(() => {
    loading = null;
  });
  return loading;
};
