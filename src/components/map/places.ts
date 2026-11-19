/**
 * The public map's data: photos placed where the API says they were taken,
 * no more precisely than their location level allows (the API rounds the
 * coordinates; parseLocation rounds them again). VRChat photos have no
 * real-world position and are left out.
 */
import {
  formatLatLng,
  groupPlaces,
  LOCATION_DECIMALS,
  uncertaintyMeters,
  type LocationPrecision,
  type Place,
} from "@shared/map/map";

import { formatTaken, type MediaInfoJSON } from "../gallery/types";

export const MAP_HREF = "/map/";

/** /map/ focused on one photo's place. */
export const mapHrefFor = (photoId: string): string =>
  `${MAP_HREF}?photo=${photoId}`;

/** How a place's precision reads in the list and popups. */
export const PRECISION_LABELS: Record<LocationPrecision, string> = {
  exact: "",
  city: "市区町村くらい",
  prefecture: "都道府県くらい",
  country: "国くらい",
};

export type MapPhoto = {
  id: string;
  file: string | null;
  /** When it was taken, as precisely as public (alt text, captions). */
  taken: string | null;
};

export type MapPlace = Place<MapPhoto> & {
  /** "35.68°N 139.77°E", plus how approximate it is. */
  label: string;
  /** Radius of the area drawn for an approximate place (m); 0 = a point. */
  radius: number;
};

export const placeLabel = (
  lat: number,
  lng: number,
  precision: LocationPrecision,
): string => {
  const coords = formatLatLng(
    lat,
    lng,
    Math.min(LOCATION_DECIMALS[precision], 4),
  );
  return precision === "exact"
    ? coords
    : `${coords}（${PRECISION_LABELS[precision]}）`;
};

/** Every public photo with a public position, by place (newest first). */
export const publicPlaces = (media: readonly MediaInfoJSON[]): MapPlace[] =>
  groupPlaces(
    media.flatMap((m) =>
      m.location && m.platform_kind !== "virtual"
        ? [
            {
              lat: m.location.latitude,
              lng: m.location.longitude,
              precision: m.location.precision,
              item: {
                id: m.id,
                file: m.file,
                taken: formatTaken(m.timestamp, m.timestamp_precision ?? null),
              },
            },
          ]
        : [],
    ),
  ).map((p) => ({
    ...p,
    label: placeLabel(p.lat, p.lng, p.precision),
    radius: uncertaintyMeters(p.precision),
  }));

/** The key of the place a photo is shown at, or null. */
export const placeOf = (
  places: readonly MapPlace[],
  photoId: string | null,
): string | null =>
  photoId === null
    ? null
    : (places.find((p) => p.items.some((i) => i.id === photoId))?.key ?? null);

/** A zoom that shows a place's area whole (a point gets a street view). */
export const ZOOM_FOR: Record<LocationPrecision, number> = {
  exact: 15,
  city: 12,
  prefecture: 9,
  country: 5,
};
