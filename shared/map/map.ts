/**
 * Map helpers shared by the public gallery (/map/) and the admin (/map/
 * and the edit page's map). Pure: no map library here (each app loads
 * MapLibre GL itself, lazily, and passes in what it needs), so this stays
 * testable with Vitest and importable from both apps.
 */

/** How precisely a position is public (the API's location.precision). */
export type LocationPrecision = "exact" | "city" | "prefecture" | "country";

/**
 * Decimals the API keeps at each level (workers/api/src/metadata.ts,
 * LOCATION_DECIMALS): about 1 m, 1 km, 10 km and 100 km.
 */
export const LOCATION_DECIMALS: Record<LocationPrecision, number> = {
  exact: 5,
  city: 2,
  prefecture: 1,
  country: 0,
};

const METERS_PER_DEGREE = 111_320;

/**
 * How far from the shown (rounded) position the photo may really have been
 * taken: half the diagonal of a rounding cell, at the equator (cells are
 * narrower towards the poles, so this is an upper bound). 0 for "exact",
 * which is shown as a point.
 */
export const uncertaintyMeters = (precision: LocationPrecision): number =>
  precision === "exact"
    ? 0
    : 0.5 *
      10 ** -LOCATION_DECIMALS[precision] *
      METERS_PER_DEGREE *
      Math.SQRT2;

/**
 * A circle of `radius` meters around a point as a closed GeoJSON ring
 * ([lng, lat] pairs), for drawing an approximate area.
 */
export const circleRing = (
  lat: number,
  lng: number,
  radius: number,
  steps = 64,
): [number, number][] => {
  const dLat = radius / METERS_PER_DEGREE;
  const dLng =
    radius /
    (METERS_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * (i % steps)) / steps;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
};

export type Place<T> = {
  /** "precision:lat,lng": the same for every photo shown at that spot. */
  key: string;
  lat: number;
  lng: number;
  precision: LocationPrecision;
  items: T[];
};

/**
 * Photos grouped by where they are shown: those at the same rounded
 * position and precision share one place. In first-seen order.
 */
export const groupPlaces = <T>(
  items: readonly {
    lat: number;
    lng: number;
    precision: LocationPrecision;
    item: T;
  }[],
): Place<T>[] => {
  const places = new Map<string, Place<T>>();
  for (const { lat, lng, precision, item } of items) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${precision}:${lat},${lng}`;
    const place = places.get(key);
    if (place) place.items.push(item);
    else places.set(key, { key, lat, lng, precision, items: [item] });
  }
  return [...places.values()];
};

/** Web Mercator world pixel of a position at a MapLibre zoom. */
export const worldPixel = (
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } => {
  // MapLibre's zoom 0 is one 512 px tile for the world.
  const size = 512 * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
};

export type Cluster<T> = {
  /** The members' mean position. */
  lat: number;
  lng: number;
  members: T[];
};

/**
 * Points that would overlap at `zoom` merged into clusters: a grid of
 * `cell` screen pixels, one cluster per occupied cell. Deterministic (the
 * same input and zoom give the same clusters, in first-seen order).
 */
export const clusterByGrid = <T extends { lat: number; lng: number }>(
  points: readonly T[],
  zoom: number,
  cell = 56,
): Cluster<T>[] => {
  const cells = new Map<string, T[]>();
  for (const p of points) {
    const { x, y } = worldPixel(p.lat, p.lng, zoom);
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  return [...cells.values()].map((members) => ({
    lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
    lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
    members,
  }));
};

/** [[west, south], [east, north]] around the points, or null if none. */
export const boundsOf = (
  points: readonly { lat: number; lng: number }[],
): [[number, number], [number, number]] | null => {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
};

/** "35.68°N 139.77°E" for a list entry (no place names yet). */
export const formatLatLng = (lat: number, lng: number, decimals = 2): string =>
  `${Math.abs(lat).toFixed(decimals)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(decimals)}°${lng >= 0 ? "E" : "W"}`;

/** A valid WGS 84 position (both finite, in range). */
export const isLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;
