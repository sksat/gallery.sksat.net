// MapLibre GL JS for the admin's maps (/map/ and the edit page's position),
// loaded on demand from visible tasks so other pages never download it.
// Tiles: OpenFreeMap (no key, no limits; see the root CLAUDE.md), its light
// or dark style after the admin's theme. E2E answers the style requests
// itself (no tiles, no network).

import type * as MapLibre from "maplibre-gl";

import { LIVE_PHOTO, isVisibility, type Visibility } from "./types";

export type MapLibreModule = typeof MapLibre;

export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/** The style for the theme on <html data-theme> (system: the OS's). */
export const mapStyleFor = (
  theme: string | undefined,
  prefersDark: boolean,
): string =>
  theme === "dark" || (theme !== "light" && prefersDark)
    ? MAP_STYLES.dark
    : MAP_STYLES.light;

let loading: Promise<MapLibreModule> | null = null;

/** The library, its worker and its CSS (browser only). */
export const loadMapLibre = (): Promise<MapLibreModule> => {
  loading ??= (async () => {
    // The CSS as a string in a lazy chunk (?inline), not a CSS asset
    // (?url): Qwik puts every CSS asset of the build in every page's head.
    const [lib, worker, css] = await Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      import("maplibre-gl/dist/maplibre-gl.css?inline"),
    ]);
    if (!document.querySelector("style[data-maplibre-css]")) {
      const style = document.createElement("style");
      style.dataset.maplibreCss = "";
      style.textContent = css.default;
      // appendChild: the Workers types' Element.append shadows the DOM's.
      document.head.appendChild(style);
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

/** The current page's map style (browser only). */
export const currentMapStyle = (): string =>
  mapStyleFor(
    document.documentElement.dataset.theme,
    matchMedia("(prefers-color-scheme: dark)").matches,
  );

export type LocatedPhoto = {
  id: number;
  file: string;
  path: string;
  /** A platform key. */
  platform: string;
  visibility: Visibility;
  timestamp: string | null;
  latitude: number;
  longitude: number;
};

/** Every listed photo with a position (private ones too), newest first. */
export const listLocatedPhotos = async (
  db: D1Database,
): Promise<LocatedPhoto[]> => {
  const res = await db
    .prepare(
      `SELECT id, file, path, platform, visibility, timestamp, latitude, longitude
       FROM media WHERE ${LIVE_PHOTO} AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY timestamp IS NULL, timestamp DESC, id DESC`,
    )
    .all<LocatedPhoto>();
  return (res.results ?? []).map((r) => ({
    ...r,
    visibility: isVisibility(r.visibility) ? r.visibility : "private",
  }));
};

/** "35.681236, 139.767125": six decimals (about 10 cm), as saved. */
export const formatPosition = (lat: number, lng: number): string =>
  `${Number(lat.toFixed(6))}, ${Number(lng.toFixed(6))}`;
