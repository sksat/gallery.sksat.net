import { inDate, parseDateKey } from "@shared/calendar/calendar";

import { cameraHref, cameraSlugFromPath, takenWith } from "./cameras";
import { DEFAULT_SORT, parseSort, serializeSort, type SortOrder } from "./sort";
import {
  filterMediaByTags,
  parseTagFilter,
  serializeTagFilter,
  type TagFilter,
} from "./tags";
import { PUBLIC_ID_RE, type MediaIndex, type MediaInfo } from "./types";

/**
 * Photos passing the tag filter and, on a camera page, taken with that
 * camera, and with a date (from the calendar), taken then. Indices stay
 * those of the full media array (they order ties when sorting); the caller
 * sorts.
 */
export const visibleMedia = (
  media: MediaIndex,
  filter: TagFilter,
  camera: string | null,
  date: string | null = null,
): { index: number; value: MediaInfo }[] =>
  filterMediaByTags(media, filter).filter(
    ({ value }) =>
      (camera === null || takenWith(value, camera)) &&
      (date === null || inDate(value.takenDate ?? null, date)),
  );

/** `?date=` of a gallery URL: a year, month or day, else null. */
export const dateParam = (params: URLSearchParams): string | null => {
  const raw = params.get("date");
  return raw !== null && parseDateKey(raw) ? raw : null;
};

/**
 * Navigate to the next or previous image within a filtered set.
 *
 * @param currentId - Current photo's public id
 * @param filteredIndices - Public ids of the filtered set, in display order
 * @param direction - "next" or "prev"
 * @returns New photo id or null if at boundary / not found (e.g. an
 *   unlisted photo, which is in no list)
 */
export const navigateImage = <T>(
  currentId: T,
  filteredIndices: T[],
  direction: "next" | "prev",
): T | null => {
  const currentFilteredIndex = filteredIndices.indexOf(currentId);
  if (currentFilteredIndex === -1) return null;

  if (direction === "next") {
    const nextIndex = currentFilteredIndex + 1;
    return nextIndex < filteredIndices.length
      ? filteredIndices[nextIndex]
      : null;
  } else {
    const prevIndex = currentFilteredIndex - 1;
    return prevIndex >= 0 ? filteredIndices[prevIndex] : null;
  }
};

/**
 * The photos before and after the open one, as ←/→ and swipes step: within
 * the filtered photos, or every photo when the open one is not among them
 * (opened from a URL). An unlisted photo is in neither: no neighbours.
 */
export const neighborIds = <T>(
  current: T,
  filteredIds: T[],
  allIds: T[],
): { prev: T | null; next: T | null } => {
  const ids = filteredIds.includes(current) ? filteredIds : allIds;
  return {
    prev: navigateImage(current, ids, "prev"),
    next: navigateImage(current, ids, "next"),
  };
};

const withQuery = (path: string, params: URLSearchParams) => {
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
};

/** The list's own query: a calendar date, the tag filter, the sort. */
const appendList = (
  params: URLSearchParams,
  filter: TagFilter,
  sort: SortOrder,
  date: string | null,
) => {
  if (date !== null) params.set("date", date);
  for (const [key, value] of new URLSearchParams(serializeTagFilter(filter)))
    params.append(key, value);
  for (const [key, value] of serializeSort(sort)) params.append(key, value);
};

/**
 * URL of a list: the gallery (`/`) or a camera page (`/camera/{slug}/`),
 * with a date from the calendar, the tag filter and sort order, so
 * reloading or going Back keeps them.
 */
export const galleryUrl = (
  filter: TagFilter,
  sort: SortOrder = DEFAULT_SORT,
  camera: string | null = null,
  date: string | null = null,
): string => {
  const params = new URLSearchParams();
  appendList(params, filter, sort, date);
  return withQuery(camera === null ? "/" : cameraHref(camera), params);
};

/**
 * A photo's own page, `/photo/{id}/` (its canonical URL, the one shared),
 * carrying the list it was opened from (`?camera=`, date, tags, sort) so
 * its previous / next and back link follow that list. The gallery's
 * overlay shows the photo at this URL too, so a reload opens its page.
 */
export const photoPageUrl = (
  imageId: string,
  filter: TagFilter = { tags: [], mode: "and" },
  sort: SortOrder = DEFAULT_SORT,
  camera: string | null = null,
  date: string | null = null,
): string => {
  const params = new URLSearchParams();
  if (camera !== null) params.set("camera", camera);
  appendList(params, filter, sort, date);
  return withQuery(`/photo/${imageId}/`, params);
};

/** The photo of a `/photo/{id}/` path (trailing slash optional), if any. */
export const photoIdFromPath = (pathname: string): string | null => {
  const match = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return match && PUBLIC_ID_RE.test(match[1]) ? match[1] : null;
};

/** What the gallery shows for a URL. */
export type GalleryUrlState = {
  /** The photo open in the overlay, else null. */
  selectedImageId: string | null;
  filter: TagFilter;
  sort: SortOrder;
  /** Camera slug of the list, else null. */
  camera: string | null;
  /** A year, month or day picked in the calendar (`?date=`), else null. */
  date: string | null;
};

/**
 * The gallery state a URL encodes: a list URL (`galleryUrl`), or a photo
 * URL (`photoPageUrl`) the overlay pushed over one, whose list is in its
 * query (`?camera=` for a camera page). The calendar leads to the whole
 * gallery only; a camera's list has no date.
 */
export const galleryStateFromUrl = (url: URL): GalleryUrlState => {
  const params = url.searchParams;
  const selectedImageId = photoIdFromPath(url.pathname);
  const camera =
    selectedImageId === null
      ? cameraSlugFromPath(url.pathname)
      : params.get("camera") || null;
  return {
    selectedImageId,
    filter: parseTagFilter(params),
    sort: parseSort(params),
    camera,
    date: camera === null ? dateParam(params) : null,
  };
};
